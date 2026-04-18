/**
 * ditch-ui.js — модуль канав v2.
 * Канава — самостоятельный объект (может быть без привязки к точке).
 * Поля: id, pointNumber(опц), ditchName, monitoringDate, worker,
 *       lat, lon, status, width, velMethod, velocity/float,
 *       distMode, nPoints, depths, dists, area, flowM3h, comment, photoUrls
 */

// ── Состояние ────────────────────────────────────────────
var DitchState = {
  list:    [],          // кэш всех канав
  vm:      'single',    // метод скорости
  unit:    'cm',        // единицы глубины
  editing: null,        // объект редактируемой канавы (null = новая)
};

// ── Инициализация ─────────────────────────────────────────

// ── Гидравлический расчётный движок ─────────────────────
// По: ГОСТ 8.486-83, Наставление вып.6, Манинг/Чугаев
function hydraulicCalc(B, depthsCm, velMethod, velParams, n_rough, I) {
  // depthsCm — промежуточные точки в сантиметрах (без Тн и Тк)
  var deps = [0].concat(depthsCm.map(function(d){ return d/100; })).concat([0]);
  var nPts = deps.length;
  var dx   = B / (nPts - 1);

  // Площадь (метод трапеций)
  var A = 0;
  for (var i = 0; i < nPts-1; i++) A += (deps[i]+deps[i+1])/2 * dx;

  // Смоченный периметр
  var chi = 0;
  for (var i = 0; i < nPts-1; i++) {
    var dh = deps[i+1]-deps[i];
    chi += Math.sqrt(dx*dx + dh*dh);
  }

  var R    = chi > 0 ? A/chi : 0;
  var hMax = Math.max.apply(null, deps);
  var hAvg = B > 0 ? A/B : 0;

  // Скорость Манинга (теоретическая)
  var v_th = (R > 0 && I > 0 && n_rough > 0)
    ? (1/n_rough) * Math.pow(R, 2/3) * Math.pow(I, 0.5)
    : 0;

  // Полевая скорость
  var v_pol = null;
  if (velMethod === 'single') {
    v_pol = parseFloat(velParams.v) || null;
  } else if (velMethod === 'float') {
    // 3 пуска — среднее без выбросов >15%
    var times = [velParams.t1, velParams.t2, velParams.t3]
      .map(function(t){ return parseFloat(t)||null; })
      .filter(function(t){ return t && t > 0; });
    if (times.length >= 2) {
      var tAvg0 = times.reduce(function(a,b){return a+b;})/times.length;
      var valid  = times.filter(function(t){ return Math.abs(t-tAvg0)/tAvg0 <= 0.15; });
      if (valid.length < 2) valid = times;
      var tAvg = valid.reduce(function(a,b){return a+b;})/valid.length;
      var L = parseFloat(velParams.L)||0;
      var K = parseFloat(velParams.K)||0.9;
      v_pol = L > 0 && tAvg > 0 ? (L/tAvg)*K : null;
    }
  } else if (velMethod === 'multi') {
    var v02 = parseFloat(velParams.v02)||0;
    var v08 = parseFloat(velParams.v08)||0;
    v_pol = (v02 + v08) / 2;
  }

  var v_use = (v_pol != null && velMethod !== 'manning') ? v_pol : v_th;
  var Q_m3s = A * v_use;
  var Q_m3h = Q_m3s * 3600;
  var Q_ls  = Q_m3s * 1000;
  var Fr    = hAvg > 0 ? v_use / Math.sqrt(9.81 * hAvg) : 0;
  var delta = (v_pol != null && v_th > 0 && velMethod !== 'manning')
    ? Math.abs(v_th - v_pol) / v_th * 100 : null;

  return {
    A:     A,     chi:   chi,   R:    R,
    hMax:  hMax,  hAvg:  hAvg,
    v_th:  v_th,  v_pol: v_pol, v_use: v_use,
    Q_m3s: Q_m3s, Q_m3h: Q_m3h, Q_ls: Q_ls,
    Fr:    Fr,    delta: delta,
    depths: deps,
    regime: Fr < 0.6 ? 'calm' : Fr < 1.0 ? 'trans' : 'rapid'
  };
}

function initDitchModule(callback) {
  Api.getDitches('').then(function(resp) {
    DitchState.list = (resp && resp.ditches) ? resp.ditches : [];
    if (typeof redrawMap === 'function') redrawMap();
    if (typeof callback === 'function') callback();
  }).catch(function(){
    if (typeof callback === 'function') callback();
  });
}

// ── Открыть форму новой канавы ───────────────────────────
function openAddDitchForm() {
  DitchState.editing = null;
  resetDitchForm();
  document.getElementById('ditch-modal-title').textContent = '🌊 Новая канава';
  // Предзаполняем дату — сегодня
  var dateEl = document.getElementById('dm-date');
  if (dateEl && !dateEl.value) dateEl.value = todayISO();
  showDitchModal();
}

// ── Открыть форму редактирования канавы ─────────────────
function openEditDitchForm(ditch) {
  DitchState.editing = ditch;
  document.getElementById('ditch-modal-title').textContent = '🌊 ' + (ditch.ditchName || 'Канава');
  // Сначала открываем модалку и строим строки, потом заполняем данными
  showDitchModal(function() { fillDitchForm(ditch); });
}

function showDitchModal(afterBuild) {
  var modal = document.getElementById('ditch-modal');
  if (modal) {
    modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  buildDitchRows();
  if (typeof afterBuild === 'function') afterBuild();
  calcDitch();
  var nameEl = document.getElementById('dm-name');
  if (nameEl) setTimeout(function(){ nameEl.focus(); }, 80);
}

function closeDitchModal() {
  var modal = document.getElementById('ditch-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';
}

// ── Заполнение формы данными канавы ─────────────────────
function fillDitchForm(d) {
  setField('dm-name',     d.ditchName     || '');
  setField('dm-point',    d.pointNumber   || '');
  setField('dm-date',     d.monitoringDate|| todayISO());
  setField('dm-worker',   d.worker        || '');
  setField('dm-lat',    d.lat    != null ? d.lat    : '');
  setField('dm-xlocal', d.xLocal != null ? d.xLocal : '');
  setField('dm-ylocal', d.yLocal != null ? d.yLocal : '');
  var hint = document.getElementById('dm-coords-hint');
  if (hint) hint.style.display = (d.xLocal != null) ? '' : 'none';
  setField('dm-lon',      d.lon != null   ? d.lon   : '');
  setField('dm-status',   d.status        || 'Активная');
  setField('dm-width',    d.width != null ? d.width : '');
  setField('dm-comment',  d.comment       || '');

  // Скорость
  var vm = d.velMethod || 'single';
  setDitchVelMethod(vm, null);
  if (vm === 'single') setField('dm-velocity', d.velocity || '');
  if (vm === 'float') {
    setField('dm-floatL',    d.floatL   || '10');
    setField('dm-float-t1',  d.floatT1  || '');
    setField('dm-float-t2',  d.floatT2  || '');
    setField('dm-float-t3',  d.floatT3  || '');
    setField('dm-floatK',    d.floatK   || '0.90');
  }
  if (vm === 'multi') {
    setField('dm-v02', d.v02 || '');
    setField('dm-v06', d.v06 || '');
    setField('dm-v08', d.v08 || '');
  }
  // Уклон и шероховатость
  setField('dm-slope-i',  d.slopeI    || '0.005');
  setField('dm-n-rough',  d.nRough    || '0.030');

  // Количество точек
  var nSel = document.getElementById('dm-npts');
  if (nSel && d.nPoints) nSel.value = d.nPoints;

  // Глубины — заполняем после buildDitchRows (который вызывается в showDitchModal до fillDitchForm)
  if (d.depths && d.depths.length) {
    var hInputs = document.querySelectorAll('#dm-depth-rows .dm-h-inp');
    d.depths.forEach(function(hm, i) {
      if (hInputs[i]) {
        // Глубины хранятся в метрах, показываем в единицах формы
        hInputs[i].value = DitchState.unit === 'cm'
          ? (hm * 100).toFixed(1)
          : hm.toFixed(4);
        hInputs[i].className = 'form-input dm-h-inp ok';
      }
    });
  }
  // Скорости для мульти-метода
  if (d.velMethod === 'multi' && d.vels && d.vels.length) {
    var vInputs = document.querySelectorAll('#dm-depth-rows .dm-v-inp');
    d.vels.forEach(function(v, i) {
      if (vInputs[i]) vInputs[i].value = v != null ? v.toFixed(3) : '';
    });
  }

  // Фото
  var prevEl = document.getElementById('dm-photo-preview');
  if (prevEl) {
    prevEl.innerHTML = '';
    if (d.photoUrls && d.photoUrls.length) {
      var img = document.createElement('img');
      img.style.cssText = 'width:100%;max-height:180px;object-fit:cover;border-radius:8px;margin-top:6px';
      img.src = '';
      img.dataset.url = d.photoUrls[0];
      Photos.setImageSrc(img, d.photoUrls[0]);
      prevEl.appendChild(img);
    }
  }
}

// ── Сброс формы ──────────────────────────────────────────
function resetDitchForm() {
  var fields = ['dm-name','dm-point','dm-date','dm-worker','dm-lat','dm-lon','dm-xlocal','dm-ylocal',
                'dm-width','dm-velocity','dm-floatT','dm-comment'];
  fields.forEach(function(id){ setField(id,''); });
  setField('dm-floatL','1');
  setField('dm-floatK','0.85');
  setField('dm-status','Активная');
  setDitchVelMethod('single', null);
  var nSel = document.getElementById('dm-npts');
  if (nSel) nSel.value = '4';
  var prevEl = document.getElementById('dm-photo-preview');
  if (prevEl) prevEl.innerHTML = '';
  hideDitchResult();
  Photos.clearInput('dm-photo', 'dm-photo-preview');
}


// ── Новая канава: сначала кликнуть на карте ─────────────
function startDitchMapPickNew() {
  if (typeof switchTab === 'function') switchTab('map');
  Toast.show('Нажмите на карте где расположена канава', 'info');
  window._ditchPickMode  = true;
  window._ditchPickIsNew = true;
  // Курсор crosshair как при добавлении точки
  setTimeout(function() {
    var canvas = document.getElementById('map-canvas');
    if (canvas) canvas.style.cursor = 'crosshair';
  }, 100);
}

// ── Выбор позиции канавы на карте ──────────────────────
function startDitchMapPick() {
  // Закрываем модалку канавы
  var modal = document.getElementById('ditch-modal');
  if (modal) modal.style.display = 'none';
  document.body.style.overflow = '';

  // Переключаемся на карту
  if (typeof switchTab === 'function') switchTab('map');

  // Показываем подсказку
  Toast.show('Нажмите на карте где расположена канава', 'info');

  // Включаем режим выбора точки для канавы
  window._ditchPickMode = true;

  // Ждём клика — обработчик в ui-map.js
}

// Вызывается из ui-map.js когда пользователь кликнул в режиме ditchPickMode
function onDitchMapPicked(xLocal, yLocal, lat, lon) {
  window._ditchPickMode = false;
  // Восстанавливаем курсор
  var _mc = document.getElementById('map-canvas');
  if (_mc) _mc.style.cursor = 'grab';

  var isNew  = window._ditchPickIsNew;
  var moveId = window._ditchPickId;
  window._ditchPickIsNew = false;
  window._ditchPickId    = null;

  // ── Режим уточнения позиции существующей канавы ────────
  if (moveId) {
    var ditch = DitchState.list.find(function(d){ return d.id === moveId; });
    if (!ditch) { Toast.show('Канава не найдена', 'error'); return; }

    var tid = Toast.progress('move-ditch', 'Обновляем позицию...');
    Api.post({
      action: 'updateDitch',
      ditch: {
        id:     moveId,
        xLocal: parseFloat(xLocal.toFixed(4)),
        yLocal: parseFloat(yLocal.toFixed(4)),
        lat:    lat != null ? parseFloat(lat.toFixed(7)) : ditch.lat,
        lon:    lon != null ? parseFloat(lon.toFixed(7)) : ditch.lon
      }
    }).then(function() {
      return new Promise(function(r){ setTimeout(r, 1500); });
    }).then(function() {
      return Api.getDitches('');
    }).then(function(resp) {
      DitchState.list = (resp && resp.ditches) ? resp.ditches : [];
      Toast.done('move-ditch', '🎯 Позиция канавы «' + ditch.ditchName + '» обновлена');
      if (typeof redrawMap === 'function') redrawMap();
      // Переключаемся обратно на карту
      if (typeof switchTab === 'function') switchTab('map');
    }).catch(function(err) {
      Toast.fail('move-ditch', 'Ошибка: ' + err.message);
    });
    return;
  }

  // ── Режим новой канавы ──────────────────────────────────
  if (isNew) {
    DitchState.editing = null;
    resetDitchForm();
    document.getElementById('ditch-modal-title').textContent = '🌊 Новая канава';
    var dateEl = document.getElementById('dm-date');
    if (dateEl && !dateEl.value) dateEl.value = todayISO();
    showDitchModal();
  }

  setField('dm-xlocal', xLocal.toFixed(4));
  setField('dm-ylocal', yLocal.toFixed(4));
  if (lat != null) setField('dm-lat', lat.toFixed(7));
  if (lon != null) setField('dm-lon', lon.toFixed(7));

  var hint = document.getElementById('dm-coords-hint');
  if (hint) hint.style.display = '';

  if (!isNew) {
    // Режим редактирования формы: возвращаемся к форме
    var modal = document.getElementById('ditch-modal');
    if (modal) modal.style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }

  buildDitchRows();

  if (DitchState.editing) {
    var d = DitchState.editing;
    if (d.depths && d.depths.length) {
      var inputs = document.querySelectorAll('#dm-depth-rows .dm-h-inp');
      d.depths.forEach(function(h, i) {
        if (inputs[i]) inputs[i].value =
          DitchState.unit === 'cm' ? (h * 100).toFixed(1) : h.toFixed(3);
      });
    }
  }
  calcDitch();

  Toast.show('Координаты канавы установлены с карты', 'success');
}

// ── GPS для канавы ───────────────────────────────────────
function getDitchGPS() {
  if (!navigator.geolocation) { Toast.show('GPS недоступен', 'error'); return; }
  Toast.show('Определяем GPS...', 'info');
  navigator.geolocation.getCurrentPosition(function(pos) {
    setField('dm-lat', pos.coords.latitude.toFixed(7));
    setField('dm-lon', pos.coords.longitude.toFixed(7));
    Toast.show('GPS определён', 'success');
  }, function() {
    Toast.show('Ошибка GPS', 'error');
  }, { timeout: 10000, enableHighAccuracy: true });
}

// ── Переключатели ─────────────────────────────────────────
function setDitchVelMethod(vm, btn) {
  DitchState.vm = vm;
  document.querySelectorAll('.dm-vel-tab').forEach(function(b){
    b.classList.toggle('active', btn ? b === btn : b.dataset.vm === vm);
  });
  var panels = { single:'dm-vm-single', float:'dm-vm-float', multi:'dm-vm-multi', manning:'dm-vm-manning' };
  Object.keys(panels).forEach(function(k){
    var el = document.getElementById(panels[k]);
    if (el) el.style.display = k === vm ? '' : 'none';
  });
  buildDitchRows();
  calcDitch();
}

function setDitchUnit(u, btn) {
  DitchState.unit = u;
  document.querySelectorAll('.dm-unit-btn').forEach(function(b){
    b.classList.toggle('active', b === btn);
  });
  document.querySelectorAll('.dm-unit-lbl').forEach(function(el){
    el.textContent = u === 'cm' ? 'см' : 'м';
  });
  calcDitch();
}

// ── Строки глубин ─────────────────────────────────────────
function buildDitchRows() {
  var container = document.getElementById('dm-depth-rows');
  if (!container) return;

  var nSel = document.getElementById('dm-npts');
  var n = nSel ? parseInt(nSel.value) : 4;
  var hasVel = DitchState.vm === 'multi';
  var cols = hasVel ? '30px 1fr 1fr' : '30px 1fr';

  // Сохраняем значения
  var oldH = [], oldV = [];
  container.querySelectorAll('.dm-h-inp').forEach(function(e){ oldH.push(e.value); });
  container.querySelectorAll('.dm-v-inp').forEach(function(e){ oldV.push(e.value); });

  container.innerHTML = '';

  // Заголовок при мульти
  if (hasVel) {
    var hdr = document.createElement('div');
    hdr.style.cssText = 'display:grid;grid-template-columns:' + cols + ';gap:6px;margin-bottom:3px';
    hdr.innerHTML =
      '<span></span>' +
      '<span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);text-align:center">Глубина</span>' +
      '<span style="font-size:9px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);text-align:center">Скорость, м/с</span>';
    container.appendChild(hdr);
  }

  for (var i = 0; i < n; i++) {
    var row = document.createElement('div');
    row.style.cssText = 'display:grid;grid-template-columns:' + cols + ';gap:6px;align-items:center;margin-bottom:4px';

    // Номер
    var nm = document.createElement('div');
    nm.className = 'dm-pt-num' + (i === 0 || i === n-1 ? ' hi' : '');
    nm.textContent = 'T' + (i + 1);
    row.appendChild(nm);

    // Глубина
    var hw = document.createElement('div');
    hw.style.cssText = 'display:flex;flex-direction:column;gap:2px';
    var hi = document.createElement('input');
    hi.type = 'number'; hi.step = '0.1'; hi.min = '0';
    hi.className = 'form-input dm-h-inp';
    hi.style.cssText = 'font-size:13px;padding:7px 10px';
    hi.placeholder = DitchState.unit === 'cm' ? 'глубина, см' : 'глубина, м';
    hi.value = oldH[i] || '';
    hi.addEventListener('input', calcDitch);
    hw.appendChild(hi);
    var hu = document.createElement('div');
    hu.className = 'dm-unit-lbl';
    hu.style.cssText = 'font-size:10px;color:var(--txt-3)';
    hu.textContent = DitchState.unit === 'cm' ? 'см' : 'м';
    hw.appendChild(hu);
    row.appendChild(hw);

    // Скорость (только мульти)
    if (hasVel) {
      var vw = document.createElement('div');
      vw.style.cssText = 'display:flex;flex-direction:column;gap:2px';
      var vi = document.createElement('input');
      vi.type = 'number'; vi.step = '0.001'; vi.min = '0';
      vi.className = 'form-input dm-v-inp';
      vi.style.cssText = 'font-size:13px;padding:7px 10px';
      vi.placeholder = 'м/с';
      vi.value = oldV[i] || '';
      vi.addEventListener('input', calcDitch);
      vw.appendChild(vi);
      var vu = document.createElement('div');
      vu.style.cssText = 'font-size:10px;color:var(--txt-3)';
      vu.textContent = 'м/с';
      vw.appendChild(vu);
      row.appendChild(vw);
    }

    container.appendChild(row);
  }

  updateDitchBndDists();
}

function updateDitchBndDists() {
  var B  = parseFloat(getField('dm-width'));
  var n  = document.querySelectorAll('#dm-depth-rows .dm-h-inp').length;
  var tn = document.getElementById('dm-tn-dist');
  var tk = document.getElementById('dm-tk-dist');
  if (!isNaN(B) && B > 0 && n > 0) {
    var dx = (B / (n + 1)).toFixed(3) + ' м';
    if (tn) tn.textContent = '→ Δx = ' + dx;
    if (tk) tk.textContent = '← Δx = ' + dx;
  } else {
    if (tn) tn.textContent = '';
    if (tk) tk.textContent = '';
  }
}

// ── Расчёт ───────────────────────────────────────────────
function calcDitch() {
  updateDitchBndDists();

  var B = parseFloat(getField('dm-width'));
  if (isNaN(B) || B <= 0) { hideDitchResult(); return; }

  var hInputs = document.querySelectorAll('#dm-depth-rows .dm-h-inp');
  if (hInputs.length < 1) { hideDitchResult(); return; }

  var depthsCm = [];
  for (var i = 0; i < hInputs.length; i++) {
    var v = parseFloat(hInputs[i].value);
    if (isNaN(v) || v < 0) { hideDitchResult(); return; }
    depthsCm.push(DitchState.unit === 'cm' ? v : v * 100);
  }

  // Параметры уклона и шероховатости
  var n_rough = parseFloat(getField('dm-n-rough')) || 0.030;
  var slopeMode = (document.getElementById('dm-slope-mode') || {}).value || 'direct';
  var I = 0;
  if (slopeMode === 'hL') {
    var dH = parseFloat(getField('dm-slope-dh')) || 0;
    var dL = parseFloat(getField('dm-slope-dl')) || 1;
    I = dL > 0 ? dH/dL : 0;
  } else {
    I = parseFloat(getField('dm-slope-i')) || 0;
  }

  // Параметры скорости по методу
  var velParams = {};
  var vm = DitchState.vm || 'single';
  if (vm === 'single') {
    velParams.v = getField('dm-velocity');
  } else if (vm === 'float') {
    velParams.L  = getField('dm-floatL');
    velParams.t1 = getField('dm-float-t1');
    velParams.t2 = getField('dm-float-t2');
    velParams.t3 = getField('dm-float-t3');
    velParams.K  = getField('dm-floatK');
  } else if (vm === 'multi') {
    velParams.v02 = getField('dm-v02');
    velParams.v08 = getField('dm-v08');
  }
  // manning — velParams пустые, используется только v_th

  var r = hydraulicCalc(B, depthsCm, vm, velParams, n_rough, I);
  if (!r || r.v_use <= 0) { hideDitchResult(); return; }

  // Показываем результат
  var resDiv = document.getElementById('dm-result');
  if (resDiv) resDiv.style.display = '';

  function setRes(id, val) {
    var el = document.getElementById(id);
    if (el) el.textContent = val;
  }

  setRes('dm-res-area',   r.A.toFixed(4) + ' м²');
  setRes('dm-res-chi',    r.chi.toFixed(3) + ' м');
  setRes('dm-res-R',      r.R.toFixed(4) + ' м');
  setRes('dm-res-hmax',   (r.hMax*100).toFixed(1) + ' см');
  setRes('dm-res-havg',   (r.hAvg*100).toFixed(1) + ' см');
  setRes('dm-res-vth',    r.v_th.toFixed(3) + ' м/с');
  setRes('dm-res-vpol',   r.v_pol != null ? r.v_pol.toFixed(3) + ' м/с' : '—');
  setRes('dm-res-vuse',   r.v_use.toFixed(3) + ' м/с');
  setRes('dm-res-flow',   r.Q_m3h.toFixed(3) + ' м³/ч');
  setRes('dm-res-qls',    r.Q_ls.toFixed(3) + ' л/с');
  setRes('dm-res-Fr',     r.Fr.toFixed(3));
  setRes('dm-res-regime', r.regime === 'calm' ? '✓ Спокойное' :
                          r.regime === 'trans' ? '! Переходное' : '⚠ Бурное');

  // Δ% между теоретической и полевой
  if (r.delta != null) {
    var dEl = document.getElementById('dm-res-delta');
    if (dEl) {
      dEl.textContent = r.delta.toFixed(1) + '%';
      dEl.style.color = r.delta > 25 ? 'var(--red)' : r.delta > 10 ? 'var(--warn)' : 'var(--ok)';
    }
  }

  // Цвет числа Фруда
  var frEl = document.getElementById('dm-res-Fr');
  if (frEl) frEl.style.color = r.regime==='calm'?'var(--ok)':r.regime==='trans'?'var(--warn)':'var(--red)';

  DitchState._calc = {
    area:    r.A,
    chi:     r.chi,
    R:       r.R,
    flowM3h: r.Q_m3h,
    flowLs:  r.Q_ls,
    vel:     r.v_use,
    v_th:    r.v_th,
    v_pol:   r.v_pol,
    Fr:      r.Fr,
    regime:  r.regime,
    delta:   r.delta,
    depths:  depthsCm.map(function(d){return d/100;}),
    I:       I,
    n_rough: n_rough,
  };
}

function hideDitchResult() {
  var el = document.getElementById('dm-result');
  if (el) el.style.display = 'none';
  DitchState._calc = null;
}

// ── Сохранение ───────────────────────────────────────────
function saveDitch() {
  var name = (getField('dm-name') || '').trim();
  if (!name) { Toast.show('Укажите название канавы', 'error'); return; }

  var B = parseFloat(getField('dm-width'));
  if (isNaN(B) || B <= 0) { Toast.show('Укажите ширину канавы', 'error'); return; }

  if (!DitchState._calc) { Toast.show('Проверьте данные — расчёт не выполнен', 'error'); return; }

  var depths  = (DitchState._calc && DitchState._calc.depths) ? DitchState._calc.depths : [];
  if (!depths.length) { Toast.show('Введите глубины точек замера', 'error'); return; }
  var nPoints = depths.length;
  var nSel    = document.getElementById('dm-npts');

  // Собираем vels для мульти
  var vels = null;
  if (DitchState.vm === 'multi') {
    var vInputs = document.querySelectorAll('#dm-depth-rows .dm-v-inp');
    vels = Array.from(vInputs).map(function(e){ return parseFloat(e.value)||0; });
  }

  var calc = DitchState._calc;
  var ditch = {
    ditchName:     name,
    pointNumber:   (getField('dm-point') || '').trim(),
    monitoringDate:getField('dm-date')   || todayISO(),
    worker:        getField('dm-worker') || '',
    lat:           parseFloat(getField('dm-lat'))    || null,
    lon:           parseFloat(getField('dm-lon'))    || null,
    xLocal:        parseFloat(getField('dm-xlocal')) || null,
    yLocal:        parseFloat(getField('dm-ylocal')) || null,
    status:        getField('dm-status') || 'Активная',
    width:         B,
    velMethod:     DitchState.vm,
    velocity:      calc.vel,
    distMode:      'u',
    nPoints:       nPoints,
    depths:        depths,
    dists:         [],
    area:          calc.area,
    chi:           calc.chi,
    R:             calc.R,
    flowM3h:       calc.flowM3h,
    flowLs:        calc.flowLs,
    v_th:          calc.v_th,
    Fr:            calc.Fr,
    regime:        calc.regime,
    delta:         calc.delta,
    slopeI:        calc.I,
    nRough:        calc.n_rough,
    comment:       getField('dm-comment') || '',
    photoUrls:     DitchState.editing ? (DitchState.editing.photoUrls || []) : [],
  };

  if (DitchState.vm === 'float') {
    ditch.floatL  = parseFloat(getField('dm-floatL'))   || 10;
    ditch.floatT1 = parseFloat(getField('dm-float-t1')) || null;
    ditch.floatT2 = parseFloat(getField('dm-float-t2')) || null;
    ditch.floatT3 = parseFloat(getField('dm-float-t3')) || null;
    ditch.floatK  = parseFloat(getField('dm-floatK'))   || 0.90;
  }
  if (DitchState.vm === 'multi') {
    ditch.v02 = parseFloat(getField('dm-v02')) || null;
    ditch.v06 = parseFloat(getField('dm-v06')) || null;
    ditch.v08 = parseFloat(getField('dm-v08')) || null;
  }
  if (DitchState.editing) ditch.id = DitchState.editing.id;

  var photoFile = Photos.getFile('dm-photo');
  var tid = Toast.progress('save-ditch', 'Сохранение канавы...');
  var action = ditch.id ? 'updateDitch' : 'createDitch';
  var isNew  = !ditch.id;

  // POST no-cors не возвращает данные — отправляем и сразу перезагружаем список
  Api.post({ action: action, ditch: ditch })
    .then(function() {
      // Ждём пока Sheets запишет данные (2 сек)
      return new Promise(function(resolve){ setTimeout(resolve, 2000); });
    })
    .then(function() {
      // Перезагружаем список канав
      return Api.getDitches('');
    })
    .then(function(resp) {
      DitchState.list = (resp && resp.ditches) ? resp.ditches : [];

      // Если есть фото — находим только что созданную канаву по имени и грузим фото
      if (photoFile) {
        // Находим канаву: для новой — по имени, для редактирования — по id
        var targetDitch = isNew
          ? DitchState.list.find(function(d) { return d.ditchName === ditch.ditchName; })
          : DitchState.list.find(function(d) { return d.id === ditch.id; });

        if (targetDitch && targetDitch.id) {
          Toast.progress('save-ditch', 'Загрузка фото...', 70);
          return Photos.uploadDitch(photoFile, targetDitch.id)
            .then(function() {
              return Api.getDitches('');
            })
            .then(function(resp2) {
              DitchState.list = (resp2 && resp2.ditches) ? resp2.ditches : [];
            })
            .catch(function(err) {
              Toast.show('Канава сохранена, фото не загрузилось: ' + (err && err.message || ''), 'warning');
            });
        }
      }
    })
    .then(function() {
      closeDitchModal();
      Toast.done('save-ditch', '🌊 Канава «' + name + '» сохранена');
      if (typeof redrawMap === 'function') redrawMap();
      if (typeof renderDitchList === 'function') renderDitchList();
    })
    .catch(function(err) {
      Toast.fail('save-ditch', 'Ошибка: ' + err.message);
    });
}

// ── Удаление канавы ──────────────────────────────────────
function deleteDitch(id, name) {
  if (!confirm('Удалить канаву «' + name + '»? Это действие нельзя отменить.')) return;
  var delTid = Toast.progress('del-ditch', 'Удаление...');
  Api.post({ action: 'deleteDitch', id: id })
    .then(function() {
      return new Promise(function(r){ setTimeout(r, 1500); });
    })
    .then(function() {
      return Api.getDitches('');
    })
    .then(function(resp) {
      DitchState.list = (resp && resp.ditches) ? resp.ditches : [];
      closeDitchModal();
      Toast.done('del-ditch', 'Канава удалена');
      if (typeof redrawMap === 'function') redrawMap();
      if (typeof renderDitchList === 'function') renderDitchList();
    })
    .catch(function(err) {
      Toast.fail('del-ditch', 'Ошибка: ' + err.message);
    });
}

// ── Рендер маркеров канав на карте ───────────────────────
// Вызывается из map.js при redrawMap()
function getDitchMarkers() {
  return DitchState.list.filter(function(d) {
    return d.lat != null && d.lon != null;
  });
}

// ── Карточка канавы (popup на карте) ─────────────────────
function renderDitchCard(ditch) {
  var html = '<div class="point-card ditch-card">';
  html += '<div class="point-card__header">';
  html += '<span class="ditch-card__icon">🌊</span>';
  html += '<span class="point-card__num">' + escAttr(ditch.ditchName) + '</span>';
  if (ditch.pointNumber) {
    html += '<span class="point-card__num" style="opacity:.6;font-size:11px"> · Т' + escAttr(ditch.pointNumber) + '</span>';
  }
  html += '<span class="badge badge--' + getDitchStatusKey(ditch.status) + '">' + escAttr(ditch.status || 'Активная') + '</span>';
  html += '</div>';

  html += '<div class="point-card__body">';
  html += '<div class="mpc-row"><span class="mpc-label">Дата</span><span>' + (ditch.monitoringDate || '—') + '</span></div>';
  html += '<div class="mpc-row"><span class="mpc-label">Сотрудник</span><span>' + escAttr(ditch.worker || '—') + '</span></div>';
  html += '<div class="mpc-row"><span class="mpc-label">Ширина</span><span>' + (ditch.width != null ? ditch.width.toFixed(2) + ' м' : '—') + '</span></div>';
  html += '<div class="mpc-row"><span class="mpc-label">Площадь S</span><span>' + (ditch.area != null ? ditch.area.toFixed(3) + ' м²' : '—') + '</span></div>';
  html += '<div class="mpc-row mpc-row--accent"><span class="mpc-label">Водоприток Q</span><span>' + (ditch.flowM3h != null ? ditch.flowM3h.toFixed(3) + ' м³/ч' : '—') + '</span></div>';
  if (ditch.comment) html += '<div class="mpc-row"><span class="mpc-label">Комментарий</span><span>' + escAttr(ditch.comment) + '</span></div>';
  html += '</div>';

  // Фото
  if (ditch.photoUrls && ditch.photoUrls[0]) {
    html += '<div class="mpc-photo-wrap"><img class="mpc-photo" id="ditch-photo-' + escAttr(ditch.id) + '" src="" alt="фото"></div>';
  }

  html += '<div class="point-card__actions">';
  html += '<button class="btn btn-sm btn-outline" onclick="openEditDitchForm(DitchState.list.find(function(d){return d.id===\'' + escAttr(ditch.id) + '\'}))">✏️ Изменить</button>';
  html += '<button class="btn btn-sm btn-outline" onclick="showDitchHistory(\'' + escAttr(ditch.id) + '\',\'' + escAttr(ditch.ditchName) + '\')">📈 История</button>';
  html += '</div>';
  html += '</div>';
  return html;
}

function getDitchStatusKey(status) {
  var map = { 'Активная':'active', 'Пересохла':'dry', 'Заилилась':'silted', 'Новая':'new' };
  return map[status] || 'active';
}

// ── История канавы ────────────────────────────────────────
function showDitchHistory(id, name) {
  Api.getDitchHistory(name).then(function(resp) {
    var hist = (resp && resp.history) ? resp.history : [];
    // Показываем в том же блоке что история точек
    renderDitchHistoryPanel(name, hist);
  }).catch(function(err) {
    Toast.show('Ошибка загрузки истории', 'error');
  });
}

function renderDitchHistoryPanel(name, hist) {
  var panel = document.getElementById('ditch-history-panel');
  if (!panel) return;

  if (!hist.length) {
    panel.innerHTML = '<div style="padding:16px;color:var(--txt-3);font-size:12px">Нет истории для «' + escAttr(name) + '»</div>';
    panel.style.display = '';
    return;
  }

  var html = '<div style="padding:14px">';
  html += '<div style="font-size:13px;font-weight:600;color:var(--txt-1);margin-bottom:10px">📈 История канавы «' + escAttr(name) + '»</div>';
  html += '<table style="width:100%;border-collapse:collapse;font-size:12px">';
  html += '<thead><tr>';
  html += '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);border-bottom:1px solid var(--line)">Дата</th>';
  html += '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);border-bottom:1px solid var(--line)">S, м²</th>';
  html += '<th style="text-align:right;padding:5px 8px;color:var(--txt-3);border-bottom:1px solid var(--line)">Q, м³/ч</th>';
  html += '<th style="text-align:left;padding:5px 8px;color:var(--txt-3);border-bottom:1px solid var(--line)">Сотрудник</th>';
  html += '</tr></thead><tbody>';

  hist.forEach(function(h) {
    html += '<tr>';
    html += '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04)">' + escAttr(h.monitoringDate) + '</td>';
    html += '<td style="padding:5px 8px;text-align:right;border-bottom:1px solid rgba(255,255,255,.04)">' + (h.area != null ? h.area.toFixed(3) : '—') + '</td>';
    html += '<td style="padding:5px 8px;text-align:right;font-weight:600;color:var(--gold);border-bottom:1px solid rgba(255,255,255,.04)">' + (h.flowM3h != null ? h.flowM3h.toFixed(3) : '—') + '</td>';
    html += '<td style="padding:5px 8px;border-bottom:1px solid rgba(255,255,255,.04);color:var(--txt-2)">' + escAttr(h.worker || '—') + '</td>';
    html += '</tr>';
  });

  html += '</tbody></table></div>';
  panel.innerHTML = html;
  panel.style.display = '';
}

// ── Список канав (для вкладки аналитики) ─────────────────
