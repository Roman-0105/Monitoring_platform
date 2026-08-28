// ── 3D-модель карьера ─────────────────────────────────────────────────────────
// Фаза 1: импорт DXF (стринги рельефа) → триангуляция (TIN) → 3D-рендер с вращением
//         + наложение точек мониторинга (реестр водопунктов + список точек).
// Зависит от: ui-utils.js (escHTML), ui-registry.js (RegistryState/RegistryApi),
//             points.js (Points), ui-sump-forecast.js (_sfLoadThree — переиспользуем
//             уже готовый загрузчик Three.js/OrbitControls).

var PitModelState = {
  loaded:  false,
  loading: false,
  _dbChecked: false,
  _dewChecked: false,
  _wellsChecked: false,

  fileName:   null,
  uploadedAt: null,

  stringerCount: 0,
  vertexCount:   0,
  triCount:      0,
  bbox:          null,   // {xMin,xMax,yMin,yMax,zMin,zMax}

  xs: null, ys: null, zs: null,  // Float64Array — облако точек стрингов
  triangles: null,               // Uint32Array — плоский массив индексов треугольников (TIN)

  showWireframe: true,
  terrainOpacity: 1,   // 1 = непрозрачный рельеф, 0 = полностью прозрачный
  layerStyle: {},      // видимость/цвет/геометрия/прозрачность по слоям (см. PIT3D_LAYER_DEFS) — заполняется в _pit3dLoadSettings()

  contourStepOverride: null,  // null = автоматический шаг; иначе число (м), заданное пользователем
  contourExcluded:     [],    // id точек, исключённых из расчёта изогипс
  _lastAutoStep:        null, // последний автоматически вычисленный шаг (подсказка в настройках)

  pointsWeekFilter: null,     // null = последние данные по каждой точке; иначе 'YYYY-Www'

  sectionPicking: false,      // true = следующие 2 клика по модели задают линию разреза
  sectionA: null,             // {x,y} первая точка линии разреза (мировые координаты)
  sectionB: null,             // {x,y} вторая точка
  savedSections: [],          // [{id,name,ax,ay,bx,by,createdAt}]

  _three: null,
  _contourData:  null,
  _contourGroup: null,
  _sectionPickGroup: null,
};

var PIT3D_DB_NAME    = 'pit3d_db';
var PIT3D_STORE      = 'model';
var PIT3D_SEC_STORE  = 'sections';
var PIT3D_DB_VERSION = 2;
var PIT3D_LS_STEP = 'pit3d_contour_step';
var PIT3D_LS_EXCL = 'pit3d_contour_excluded';
var PIT3D_LS_LAYERS = 'pit3d_layer_style';

/* ── Слои: определения и стиль по умолчанию ──────────────────────────────────
   Единая панель настроек ("Слои") под окном 3D-модели — для каждого слоя своя
   видимость/цвет/геометрия маркера/прозрачность + кнопка "Таблица" с данными XYZ.
   Изогипсы — особый слой: линии с готовым градиентом по глубине, без цвета/геометрии,
   свои настройки (шаг, точки) остаются в отдельном попапе ⚙. */
var PIT3D_LAYER_DEFS = [
  { key: 'reg_well_obs',  label: 'Наблюд. скважина',                 color: '#60a5fa', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'reg_well_exp',  label: 'Эксплуат. скважина',                color: '#34d399', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'reg_sump',      label: 'Зумпф (реестр)',                    color: '#f59e0b', geometry: 'cube',   group: 'Реестр водопунктов' },
  { key: 'reg_pond',      label: 'Накопитель',                        color: '#a78bfa', geometry: 'cube',   group: 'Реестр водопунктов' },
  { key: 'reg_seep',      label: 'Водопроявление (реестр)',           color: '#22d3ee', geometry: 'cone',   group: 'Реестр водопунктов' },
  { key: 'reg_other',     label: 'Прочее (реестр)',                   color: '#9aa0a6', geometry: 'sphere', group: 'Реестр водопунктов' },
  { key: 'points',        label: 'Водопроявления (Список точек)',     color: '#22d3ee', geometry: 'sphere', group: 'Прочие источники данных' },
  { key: 'dewsump',       label: 'Зумпфы (Журнал Водоотлива)',        color: '#fb923c', geometry: 'sphere', group: 'Прочие источники данных' },
  { key: 'wells_drainage', label: 'Скважины дренажные',                color: '#4caf7d', geometry: 'sphere', isWell: true, group: 'Гор. скважины' },
  { key: 'wells_piezo',   label: 'Скважины пьезометрические',         color: '#9d6bff', geometry: 'sphere', isWell: true, group: 'Гор. скважины' },
  { key: 'isohypses',     label: 'Изогипсы подземных вод',            special: true, group: 'Расчётные слои' },
];

function _pit3dDefaultLayerStyle() {
  var out = {};
  PIT3D_LAYER_DEFS.forEach(function(d) {
    out[d.key] = { visible: d.key !== 'isohypses', color: d.color || null, geometry: d.geometry || null, opacity: 1, size: 1 };
  });
  return out;
}

function _pit3dLoadSettings() {
  try {
    var step = localStorage.getItem(PIT3D_LS_STEP);
    PitModelState.contourStepOverride = step ? parseFloat(step) : null;
  } catch(e) {}
  try {
    var excl = localStorage.getItem(PIT3D_LS_EXCL);
    PitModelState.contourExcluded = excl ? JSON.parse(excl) : [];
  } catch(e) { PitModelState.contourExcluded = []; }
  var defaults = _pit3dDefaultLayerStyle();
  try {
    var saved = localStorage.getItem(PIT3D_LS_LAYERS);
    var parsed = saved ? JSON.parse(saved) : {};
    Object.keys(defaults).forEach(function(k) { defaults[k] = Object.assign({}, defaults[k], parsed[k] || {}); });
  } catch(e) {}
  PitModelState.layerStyle = defaults;
}
function _pit3dSaveStep() {
  try {
    if (PitModelState.contourStepOverride == null) localStorage.removeItem(PIT3D_LS_STEP);
    else localStorage.setItem(PIT3D_LS_STEP, String(PitModelState.contourStepOverride));
  } catch(e) {}
}
function _pit3dSaveExcluded() {
  try { localStorage.setItem(PIT3D_LS_EXCL, JSON.stringify(PitModelState.contourExcluded)); } catch(e) {}
}
function _pit3dSaveLayerStyle() {
  try { localStorage.setItem(PIT3D_LS_LAYERS, JSON.stringify(PitModelState.layerStyle)); } catch(e) {}
}
_pit3dLoadSettings();

/* ── Локальное хранилище модели (IndexedDB — файл слишком большой для localStorage) ── */
function _pit3dDbOpen() {
  return new Promise(function(resolve, reject) {
    var req = indexedDB.open(PIT3D_DB_NAME, PIT3D_DB_VERSION);
    req.onupgradeneeded = function() {
      var db = req.result;
      if (!db.objectStoreNames.contains(PIT3D_STORE))     db.createObjectStore(PIT3D_STORE);
      if (!db.objectStoreNames.contains(PIT3D_SEC_STORE))  db.createObjectStore(PIT3D_SEC_STORE, { keyPath: 'id' });
    };
    req.onsuccess = function() { resolve(req.result); };
    req.onerror   = function() { reject(req.error); };
  });
}

function _pit3dDbSave(record) {
  return _pit3dDbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PIT3D_STORE, 'readwrite');
      tx.objectStore(PIT3D_STORE).put(record, 'current');
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function() { reject(tx.error); };
    });
  });
}

function _pit3dDbLoad() {
  return _pit3dDbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(PIT3D_STORE, 'readonly');
      var req = tx.objectStore(PIT3D_STORE).get('current');
      req.onsuccess = function() { resolve(req.result || null); };
      req.onerror   = function() { reject(req.error); };
    });
  });
}

function _pit3dDbClear() {
  return _pit3dDbOpen().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction(PIT3D_STORE, 'readwrite');
      tx.objectStore(PIT3D_STORE).delete('current');
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function() { resolve(); };
    });
  });
}

/* ── Хранилище сохранённых разрезов (та же IndexedDB, отдельный store) ───────── */
function _pit3dSectionsLoadAll() {
  return _pit3dDbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx  = db.transaction(PIT3D_SEC_STORE, 'readonly');
      var req = tx.objectStore(PIT3D_SEC_STORE).getAll();
      req.onsuccess = function() { resolve(req.result || []); };
      req.onerror   = function() { reject(req.error); };
    });
  });
}
function _pit3dSectionsSave(rec) {
  return _pit3dDbOpen().then(function(db) {
    return new Promise(function(resolve, reject) {
      var tx = db.transaction(PIT3D_SEC_STORE, 'readwrite');
      tx.objectStore(PIT3D_SEC_STORE).put(rec);
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function() { reject(tx.error); };
    });
  });
}
function _pit3dSectionsDelete(id) {
  return _pit3dDbOpen().then(function(db) {
    return new Promise(function(resolve) {
      var tx = db.transaction(PIT3D_SEC_STORE, 'readwrite');
      tx.objectStore(PIT3D_SEC_STORE).delete(id);
      tx.oncomplete = function() { resolve(); };
      tx.onerror    = function() { resolve(); };
    });
  });
}

/* ── Загрузка d3-delaunay (триангуляция TIN) ─────────────────────────────────── */
function _pit3dLoadDelaunay() {
  if (window.d3 && window.d3.Delaunay) return Promise.resolve();
  return new Promise(function(resolve, reject) {
    var s = document.createElement('script');
    s.src = 'https://unpkg.com/d3-delaunay@6/dist/d3-delaunay.min.js';
    s.onload  = function() { resolve(); };
    s.onerror = function() { reject(new Error('Не удалось загрузить d3-delaunay')); };
    document.head.appendChild(s);
  });
}

function _pit3dYield() {
  return new Promise(function(resolve) { setTimeout(resolve, 20); });
}

/* ── Парсинг DXF ──────────────────────────────────────────────────────────────
   Формат записи: пара строк [код группы, значение]. Извлекаем старые 3D-полилинии
   POLYLINE → VERTEX(10/20/30=X/Y/Z) → SEQEND — это и есть "стринги" рельефа. */
function _pit3dParseDXF(text) {
  var lines = text.split(/\r\n|\r|\n/);
  var n = lines.length;

  var xsArr = [], ysArr = [], zsArr = [];
  var stringerCount = 0;
  var curEntity = null;  // 'VERTEX' | null
  var vx = 0, vy = 0, vz = 0;

  function flush() {
    if (curEntity === 'VERTEX') { xsArr.push(vx); ysArr.push(vy); zsArr.push(vz); }
  }

  for (var i = 0; i + 1 < n; i += 2) {
    var code = parseInt(lines[i], 10);
    var val  = lines[i + 1];
    if (code === 0) {
      flush();
      var etype = val.trim();
      vx = vy = vz = 0;
      if (etype === 'POLYLINE') { stringerCount++; curEntity = null; }
      else if (etype === 'VERTEX') { curEntity = 'VERTEX'; }
      else { curEntity = null; }
    } else if (curEntity === 'VERTEX') {
      if      (code === 10) vx = parseFloat(val);
      else if (code === 20) vy = parseFloat(val);
      else if (code === 30) vz = parseFloat(val);
    }
  }
  flush();

  return { xs: xsArr, ys: ysArr, zs: zsArr, stringerCount: stringerCount, vertexCount: xsArr.length };
}

/* ── Построение TIN (триангуляция Делоне по X/Y, Z берём из исходных точек) ──── */
async function _pit3dBuildTIN(xsArr, ysArr, zsArr) {
  await _pit3dLoadDelaunay();
  var count = xsArr.length;
  var coords = new Float64Array(count * 2);
  for (var i = 0; i < count; i++) { coords[i*2] = xsArr[i]; coords[i*2+1] = ysArr[i]; }
  var delaunay = new d3.Delaunay(coords);
  return {
    xs: Float64Array.from(xsArr),
    ys: Float64Array.from(ysArr),
    zs: Float64Array.from(zsArr),
    triangles: delaunay.triangles, // Uint32Array, плоские тройки индексов
  };
}

function _pit3dComputeBBox(xs, ys, zs) {
  var xMin=xs[0],xMax=xs[0],yMin=ys[0],yMax=ys[0],zMin=zs[0],zMax=zs[0];
  for (var i=1;i<xs.length;i++){
    if(xs[i]<xMin)xMin=xs[i]; if(xs[i]>xMax)xMax=xs[i];
    if(ys[i]<yMin)yMin=ys[i]; if(ys[i]>yMax)yMax=ys[i];
    if(zs[i]<zMin)zMin=zs[i]; if(zs[i]>zMax)zMax=zs[i];
  }
  return { xMin:xMin, xMax:xMax, yMin:yMin, yMax:yMax, zMin:zMin, zMax:zMax };
}

// Устойчивый охват по X/Y — метод Тьюки (за пределами Q1-K*IQR..Q3+K*IQR), K=3 ("дальние" выбросы).
// В отличие от фиксированных перцентилей, не режет легитимный непрерывный массив точек —
// срабатывает только на реально обособленные кластеры (например, случайный объект у начала
// координат чертежа). Полный bbox (со всеми точками) сохраняется отдельно — данные не теряются.
function _pit3dComputeRobustBBox(xs, ys, zs) {
  function quartiles(arr) {
    var sorted = Array.from(arr).sort(function(a,b){ return a-b; });
    return { q1: sorted[Math.floor(sorted.length*0.25)], q3: sorted[Math.floor(sorted.length*0.75)] };
  }
  var K = 3;
  var qx = quartiles(xs), qy = quartiles(ys);
  var xFence = { lo: qx.q1 - K*(qx.q3-qx.q1), hi: qx.q3 + K*(qx.q3-qx.q1) };
  var yFence = { lo: qy.q1 - K*(qy.q3-qy.q1), hi: qy.q3 + K*(qy.q3-qy.q1) };

  var xMin=Infinity,xMax=-Infinity,yMin=Infinity,yMax=-Infinity,zMin=Infinity,zMax=-Infinity, kept=false;
  for (var i=0;i<xs.length;i++){
    if (xs[i]<xFence.lo || xs[i]>xFence.hi || ys[i]<yFence.lo || ys[i]>yFence.hi) continue;
    kept = true;
    if(xs[i]<xMin)xMin=xs[i]; if(xs[i]>xMax)xMax=xs[i];
    if(ys[i]<yMin)yMin=ys[i]; if(ys[i]>yMax)yMax=ys[i];
    if(zs[i]<zMin)zMin=zs[i]; if(zs[i]>zMax)zMax=zs[i];
  }
  return kept ? { xMin:xMin, xMax:xMax, yMin:yMin, yMax:yMax, zMin:zMin, zMax:zMax } : _pit3dComputeBBox(xs, ys, zs);
}

function _pit3dCountOutliers(xs, ys, robust) {
  var n = 0;
  for (var i = 0; i < xs.length; i++) {
    if (xs[i] < robust.xMin || xs[i] > robust.xMax || ys[i] < robust.yMin || ys[i] > robust.yMax) n++;
  }
  return n;
}

/* ── Загрузка файла пользователем ─────────────────────────────────────────────── */
async function _pit3dOnFileInput(event) {
  var file = event.target.files[0];
  if (!file) return;

  PitModelState.loading = true;
  _pit3dSetStatus('Чтение файла (' + (file.size/1024/1024).toFixed(1) + ' МБ)...');
  await _pit3dYield();

  try {
    var text = await file.text();

    _pit3dSetStatus('Парсинг DXF... для больших файлов может занять до минуты');
    await _pit3dYield();
    var parsed = _pit3dParseDXF(text);
    text = null; // освобождаем память — исходный текст больше не нужен

    if (!parsed.vertexCount) {
      _pit3dSetStatus('В файле не найдено 3D-полилиний (стрингов POLYLINE/VERTEX). Проверьте формат экспорта.', true);
      PitModelState.loading = false;
      return;
    }

    _pit3dSetStatus('Триангуляция рельефа (' + parsed.vertexCount.toLocaleString('ru-RU') + ' точек)...');
    await _pit3dYield();
    var tin    = await _pit3dBuildTIN(parsed.xs, parsed.ys, parsed.zs);
    var bbox   = _pit3dComputeBBox(tin.xs, tin.ys, tin.zs);
    var robust = _pit3dComputeRobustBBox(tin.xs, tin.ys, tin.zs);
    var outlierCount = _pit3dCountOutliers(tin.xs, tin.ys, robust);

    PitModelState.xs = tin.xs; PitModelState.ys = tin.ys; PitModelState.zs = tin.zs;
    PitModelState.triangles     = tin.triangles;
    PitModelState.bbox          = bbox;
    PitModelState.robustBBox    = robust;
    PitModelState.outlierCount  = outlierCount;
    PitModelState.stringerCount = parsed.stringerCount;
    PitModelState.vertexCount   = parsed.vertexCount;
    PitModelState.triCount      = tin.triangles.length / 3;
    PitModelState.fileName      = file.name;
    PitModelState.uploadedAt    = new Date().toISOString();
    PitModelState.loaded        = true;
    PitModelState.loading       = false;

    _pit3dSetStatus('Сохранение модели в браузере...');
    try {
      await _pit3dDbSave({
        xs: tin.xs, ys: tin.ys, zs: tin.zs, triangles: tin.triangles, bbox: bbox,
        robustBBox: robust, outlierCount: outlierCount,
        stringerCount: parsed.stringerCount, vertexCount: parsed.vertexCount,
        fileName: file.name, uploadedAt: PitModelState.uploadedAt,
      });
    } catch (e) { console.warn('[pit3d] IndexedDB save failed', e); }

    _pit3dRenderPanel();
    await _pit3dTryRender3D();
  } catch (e) {
    console.error('[pit3d] parse error', e);
    _pit3dSetStatus('Ошибка обработки файла: ' + e.message, true);
    PitModelState.loading = false;
  }
}

async function _pit3dClearModel() {
  if (!confirm('Удалить загруженную 3D-модель карьера? Понадобится загрузить DXF заново.')) return;
  _pit3dDestroy3D();
  PitModelState.loaded = false;
  PitModelState.xs = PitModelState.ys = PitModelState.zs = null;
  PitModelState.triangles = null;
  PitModelState.bbox = null;
  PitModelState.fileName = null;
  PitModelState._contourData = null;
  PitModelState.layerStyle.isohypses.visible = false;
  PitModelState.sectionPicking = false;
  PitModelState.sectionA = null;
  PitModelState.sectionB = null;
  try { await _pit3dDbClear(); } catch(e) {}
  _pit3dRenderPanel();
}

/* ── Точки мониторинга: реестр водопунктов + список точек (водопроявления) ──── */
function _pit3dWpLabel(t) {
  var map = { well_obs:'Наблюд. скважина', well_exp:'Эксплуат. скважина', sump:'Зумпф', pond:'Накопитель', seep:'Водопроявление', other:'Прочее' };
  return map[t] || t || 'Точка';
}

function _pit3dNearestZ(x, y) {
  var xs = PitModelState.xs, ys = PitModelState.ys, zs = PitModelState.zs;
  if (!xs || !xs.length) return null;
  var bestD = Infinity, bestZ = zs[0];
  for (var i = 0; i < xs.length; i++) {
    var dx = xs[i]-x, dy = ys[i]-y;
    var d = dx*dx + dy*dy;
    if (d < bestD) { bestD = d; bestZ = zs[i]; }
  }
  return bestZ;
}

// "Список точек" хранит один замер = одна дата = одна строка (много строк на физическую точку).
// Для карты/модели нужна только последняя по дате запись на каждый номер точки.
function _pit3dLatestPoints() {
  if (typeof Points === 'undefined' || typeof Points.getList !== 'function') return [];
  var byNum = {};
  Points.getList().forEach(function(p) {
    var cur = byNum[p.pointNumber];
    if (!cur || p.monitoringDate > cur.monitoringDate) byNum[p.pointNumber] = p;
  });
  return Object.keys(byNum).map(function(k) { return byNum[k]; });
}

// Замеры конкретной недели (Пн-Вс, по getWeekDateRange из ui-utils.js) — по одной, последней
// в пределах недели, записи на физическую точку. Точки без замера в эту неделю просто не попадают.
function _pit3dPointsForWeek(weekKey) {
  if (typeof Points === 'undefined' || typeof Points.getList !== 'function') return [];
  if (typeof getWeekDateRange !== 'function') return _pit3dLatestPoints();
  var range = getWeekDateRange(weekKey);
  var byNum = {};
  Points.getList().forEach(function(p) {
    if (!p.monitoringDate || p.monitoringDate < range.start || p.monitoringDate > range.end) return;
    var cur = byNum[p.pointNumber];
    if (!cur || p.monitoringDate > cur.monitoringDate) byNum[p.pointNumber] = p;
  });
  return Object.keys(byNum).map(function(k) { return byNum[k]; });
}

// Список доступных недель (по факту наличия замеров), новые сверху
function _pit3dAvailableWeeks() {
  if (typeof Points === 'undefined' || typeof getWeekKeyFromDate !== 'function') return [];
  var set = {};
  Points.getList().forEach(function(p) { if (p.monitoringDate) set[getWeekKeyFromDate(p.monitoringDate)] = true; });
  return Object.keys(set).sort().reverse();
}

function _pit3dWeekLabel(weekKey) {
  if (typeof getWeekDateRange !== 'function') return weekKey;
  var r = getWeekDateRange(weekKey);
  function short(d) { return new Date(d+'T00:00:00').toLocaleDateString('ru-RU', {day:'numeric', month:'short'}); }
  return short(r.start) + '–' + short(r.end);
}

// Точки водопроявлений с учётом текущего фильтра по неделе (null = последние данные по каждой точке)
function _pit3dActivePoints() {
  return PitModelState.pointsWeekFilter ? _pit3dPointsForWeek(PitModelState.pointsWeekFilter) : _pit3dLatestPoints();
}

function _pit3dCollectMonitoringPoints(ignoreVisibility) {
  var out = [];

  if (typeof RegistryState !== 'undefined' && Array.isArray(RegistryState.items)) {
    RegistryState.items.forEach(function(w) {
      var x = parseFloat(w.coord_x), y = parseFloat(w.coord_y);
      if (isNaN(x) || isNaN(y)) return;
      var z = null;
      if (w.wp_type === 'well_obs' || w.wp_type === 'well_exp') {
        var lvl = (RegistryState.wellLevelsLatest || {})[w.id];
        z = lvl ? lvl.elevation : parseFloat(w.elev_z);
      } else {
        z = parseFloat(w.elev_z);
      }
      if (isNaN(z)) z = null;
      var layerKey = 'reg_' + (PIT3D_LAYER_DEFS.some(function(d){return d.key==='reg_'+w.wp_type;}) ? w.wp_type : 'other');
      out.push({ x:x, y:y, z:z, name: w.name || w.code || 'Точка', label: _pit3dWpLabel(w.wp_type), source: 'registry', layerKey: layerKey });
    });
  }

  _pit3dActivePoints().forEach(function(p) {
    if (p.xLocal == null || p.yLocal == null) return;
    var z = parseFloat(p.horizon);
    out.push({ x: p.xLocal, y: p.yLocal, z: isNaN(z) ? null : z, name: p.pointNumber || 'Точка', label: 'Водопроявление',
      source: 'points', layerKey: 'points', photoUrls: Array.isArray(p.photoUrls) ? p.photoUrls : [], measDate: p.monitoringDate });
  });

  if (typeof DewateringState !== 'undefined' && Array.isArray(DewateringState.sumps)) {
    DewateringState.sumps.forEach(function(s) {
      var x = parseFloat(s.coordX), y = parseFloat(s.coordY);
      if (isNaN(x) || isNaN(y)) return;
      var lvl = DewateringState.latestWaterLevel(s.id);
      out.push({ x:x, y:y, z: lvl ? lvl.elevation : null, name: s.name || 'Зумпф', label: 'Зумпф (водоотлив)', source: 'dewsump', layerKey: 'dewsump' });
    });
  }

  // Оставляем точки в пределах модели (с небольшим запасом)
  var b = PitModelState.bbox;
  if (b) {
    var mx = (b.xMax - b.xMin) * 0.15 || 100, my = (b.yMax - b.yMin) * 0.15 || 100;
    out = out.filter(function(p) { return p.x >= b.xMin - mx && p.x <= b.xMax + mx && p.y >= b.yMin - my && p.y <= b.yMax + my; });
  }

  // Без явной отметки — "накладываем" на рельеф по ближайшей точке TIN
  out.forEach(function(p) { if (p.z == null) p.z = _pit3dNearestZ(p.x, p.y); });

  // Скрываем то, что выключено в панели "Слои" (кроме случаев, когда нужны все точки, например для таблицы слоя)
  if (!ignoreVisibility) {
    out = out.filter(function(p) { var st = PitModelState.layerStyle[p.layerKey]; return !st || st.visible; });
  }

  return out;
}

// Геометрия маркера по выбранной в слое форме
function _pit3dMakeGeometry(shape, r) {
  switch (shape) {
    case 'cube': return new THREE.BoxGeometry(r*1.6, r*1.6, r*1.6);
    case 'cone': return new THREE.ConeGeometry(r*1.1, r*2.2, 10);
    case 'diamond': return new THREE.OctahedronGeometry(r*1.3);
    default: return new THREE.SphereGeometry(r, 12, 12);
  }
}

// Перестраивает только группу маркеров точек мониторинга в уже существующей 3D-сцене
// (например, при смене фильтра по неделе) — без пересборки рельефа/камеры/изогипс
function _pit3dRebuildMarkerGroup() {
  var t = PitModelState._three;
  if (!t || typeof THREE === 'undefined') return;
  if (t.markerGroup) {
    t.scene.remove(t.markerGroup);
    t.markerGroup.children.forEach(function(m) { m.geometry.dispose(); m.material.dispose(); });
  }
  var tr = t.transform;
  var group = new THREE.Group();
  _pit3dCollectMonitoringPoints().forEach(function(p) {
    var st = PitModelState.layerStyle[p.layerKey] || {};
    var color = st.color || '#f59e0b';
    var mat = new THREE.MeshBasicMaterial({ color: color, transparent: st.opacity < 1, opacity: st.opacity != null ? st.opacity : 1 });
    var geo = _pit3dMakeGeometry(st.geometry, t.markerR * (st.size != null ? st.size : 1));
    var mesh = new THREE.Mesh(geo, mat);
    mesh.position.set((p.x-tr.cx)*tr.scale, (p.z-tr.cz)*tr.scale, -(p.y-tr.cy)*tr.scale);
    mesh.userData = p;
    group.add(mesh);
  });
  group.visible = true; // видимость теперь регулируется на уровне каждого слоя в панели "Слои"
  t.scene.add(group);
  t.markerGroup = group;
}

// Траектории горизонтальных/пьезометрических скважин (WellsState, модуль "Гор. скважины").
// Азимут даёт направление в плоскости XY (тот же принцип, что и на 2D-плане скважин —
// _renderWellShafts в ui-wells.js). Угол наклона на 2D-плане намеренно не участвует в
// расчёте (там показан только вид сверху, "справочно"), но здесь, в 3D-модели, именно он
// определяет реальное погружение ствола, поэтому используем его для вычисления конца ствола.
// Знак: по имеющимся данным (все пьезометры с наклоном — отрицательные значения, скважины
// дренажа пробурены с уклоном вниз для самотёка воды) отрицательный угол = вниз от устья.
function _pit3dCollectWellTrajectories() {
  if (typeof WellsState === 'undefined' || !Array.isArray(WellsState.list)) return [];
  var out = [];
  WellsState.list.forEach(function(w) {
    if (w.xLocal == null || w.yLocal == null) return;
    var z = w.zLocal != null ? w.zLocal : _pit3dNearestZ(w.xLocal, w.yLocal);
    var hasReach = w.azimuth != null && w.depth != null && w.depth > 0;
    var inclRad = (w.inclination || 0) * Math.PI / 180;
    var reach = hasReach ? w.depth * Math.cos(inclRad) : 0;
    var dz    = hasReach ? w.depth * Math.sin(inclRad) : 0;
    var az = (w.azimuth || 0) * Math.PI / 180;
    var endX = w.xLocal + reach * Math.sin(az);
    var endY = w.yLocal + reach * Math.cos(az);
    out.push({
      id: w.id, name: w.name || 'Скважина', isPiezo: w.wellType === 'piezometric',
      collar: { x: w.xLocal, y: w.yLocal, z: z },
      end:    { x: endX,     y: endY,     z: z + dz },
      sensors: (w.wellType === 'piezometric' && Array.isArray(w.sensors)) ? w.sensors : [],
      depth: w.depth, azimuth: w.azimuth, inclination: w.inclination, status: w.status,
    });
  });
  return out;
}

function _pit3dRebuildWellsGroup() {
  var t = PitModelState._three;
  if (!t || typeof THREE === 'undefined') return;
  if (t.wellsGroup) {
    t.scene.remove(t.wellsGroup);
    t.wellsGroup.traverse(function(o) { if (o.geometry) o.geometry.dispose(); if (o.material) o.material.dispose(); });
  }
  var tr = t.transform;
  var group = new THREE.Group();

  function toLocal(p) { return new THREE.Vector3((p.x-tr.cx)*tr.scale, (p.z-tr.cz)*tr.scale, -(p.y-tr.cy)*tr.scale); }

  _pit3dCollectWellTrajectories().forEach(function(w) {
    var layerKey = w.isPiezo ? 'wells_piezo' : 'wells_drainage';
    var st = PitModelState.layerStyle[layerKey] || {};
    if (!st.visible) return;
    var color = st.color || (w.isPiezo ? '#9d6bff' : '#4caf7d');
    var opacity = st.opacity != null ? st.opacity : 1;
    var sizeMul = st.size != null ? st.size : 1;
    var c0 = toLocal(w.collar), c1 = toLocal(w.end);

    // Ствол — тонкий цилиндр между устьем и концом (видимее, чем просто линия)
    var dir = new THREE.Vector3().subVectors(c1, c0);
    var len = dir.length();
    if (len > 1e-4) {
      var shaftGeo = new THREE.CylinderGeometry(t.markerR*0.28*sizeMul, t.markerR*0.28*sizeMul, len, 6);
      var shaftMat = new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: opacity * (w.isPiezo ? 0.9 : 0.75) });
      var shaft = new THREE.Mesh(shaftGeo, shaftMat);
      shaft.position.copy(c0).addScaledVector(dir, 0.5);
      shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0,1,0), dir.clone().normalize());
      shaft.userData = { isWell: true, name: w.name, label: w.isPiezo ? 'Пьезометрическая скважина' : 'Горизонтальная скважина',
        z: w.collar.z, extra: (w.azimuth!=null?'Азимут ' + w.azimuth + '°':'') + (w.depth!=null?(w.azimuth!=null?', ':'')+'Глубина ' + w.depth + ' м':'') };
      group.add(shaft);
    }

    // Устье — маркер формы, заданной в слое
    var headMat = new THREE.MeshBasicMaterial({ color: color, transparent: opacity < 1, opacity: opacity });
    var head = new THREE.Mesh(_pit3dMakeGeometry(st.geometry, t.markerR*0.7*sizeMul), headMat);
    head.position.copy(c0);
    head.userData = { isWell: true, name: w.name, label: w.isPiezo ? 'Пьезометрическая скважина (устье)' : 'Горизонтальная скважина (устье)',
      z: w.collar.z, extra: (w.azimuth!=null?'Азимут ' + w.azimuth + '°':'') + (w.depth!=null?(w.azimuth!=null?', ':'')+'Глубина ' + w.depth + ' м':'') };
    group.add(head);

    // Датчики VWP вдоль ствола пьезометрической скважины
    if (w.sensors.length && w.depth) {
      w.sensors.forEach(function(s) {
        if (s.depth == null || s.depth <= 0 || s.depth > w.depth) return;
        var ratio = s.depth / w.depth;
        var sp = new THREE.Vector3().lerpVectors(c0, c1, ratio);
        var sMat = new THREE.MeshBasicMaterial({ color: s.connectedToLogger ? 0x4caf7d : 0x9aa0a6 });
        var sDot = new THREE.Mesh(new THREE.SphereGeometry(t.markerR*0.45*sizeMul, 8, 8), sMat);
        sDot.position.copy(sp);
        sDot.userData = { isWell: true, name: (s.name || 'Датчик') + ' — ' + w.name, label: 'Датчик VWP, глубина ' + s.depth + ' м',
          z: w.collar.z + ratio * (w.end.z - w.collar.z), extra: s.serialNumber ? 'S/N ' + s.serialNumber : '' };
        group.add(sDot);
      });
    }
  });

  group.visible = true; // видимость теперь регулируется на уровне каждого слоя (wells_drainage/wells_piezo)
  t.scene.add(group);
  t.wellsGroup = group;
}

/* ── Панель "Слои": общие сеттеры стиля + точечная пересборка нужной группы ──── */
function _pit3dSetLayerVisible(key, checked) {
  var st = PitModelState.layerStyle[key]; if (!st) return;
  st.visible = checked;
  _pit3dSaveLayerStyle();
  if (key === 'isohypses') { _pit3dToggleContours(checked); return; }
  _pit3dRefreshLayer(key);
}
function _pit3dSetLayerColor(key, color) {
  var st = PitModelState.layerStyle[key]; if (!st) return;
  st.color = color;
  _pit3dSaveLayerStyle();
  _pit3dRefreshLayer(key);
}
function _pit3dSetLayerGeometry(key, geom) {
  var st = PitModelState.layerStyle[key]; if (!st) return;
  st.geometry = geom;
  _pit3dSaveLayerStyle();
  _pit3dRefreshLayer(key);
}
function _pit3dSetLayerOpacity(key, val) {
  var st = PitModelState.layerStyle[key]; if (!st) return;
  st.opacity = parseFloat(val);
  _pit3dSaveLayerStyle();
  _pit3dRefreshLayer(key);
}
function _pit3dSetLayerSize(key, val) {
  var st = PitModelState.layerStyle[key]; if (!st) return;
  st.size = parseFloat(val) || 1;
  _pit3dSaveLayerStyle();
  _pit3dRefreshLayer(key);
}
function _pit3dRefreshLayer(key) {
  if (key === 'isohypses') {
    if (!PitModelState._contourData) return;
    var t = PitModelState._three;
    if (t && PitModelState._contourGroup) {
      t.scene.remove(PitModelState._contourGroup);
      PitModelState._contourGroup.children.forEach(function(l) { l.geometry.dispose(); l.material.dispose(); });
    }
    if (t) { _pit3dAddContourGroupToScene(PitModelState._contourData); PitModelState._contourGroup.visible = !!PitModelState.layerStyle.isohypses.visible; }
    return;
  }
  if (key === 'wells_drainage' || key === 'wells_piezo') { _pit3dRebuildWellsGroup(); return; }
  _pit3dRebuildMarkerGroup();
}

/* ── Фаза 2: изогипсы подземных вод ──────────────────────────────────────────
   Строим отдельный, разреженный TIN по точкам с известной абс. отметкой уровня
   воды (скважины из реестра + последние замеры водопроявлений из "Списка точек"),
   затем трассируем линии пересечения этого TIN с горизонтальными плоскостями —
   тот же принцип, что и для рельефа (_pit3dBuildTIN), просто по другим точкам. */
// Все точки-кандидаты (со стабильным id) — независимо от текущих исключений.
// Используется и для расчёта изогипс (после фильтра), и для списка в настройках.
function _pit3dAllWaterTableCandidates() {
  var out = [];

  if (typeof RegistryState !== 'undefined' && Array.isArray(RegistryState.items)) {
    RegistryState.items.forEach(function(w) {
      var x = parseFloat(w.coord_x), y = parseFloat(w.coord_y);
      if (isNaN(x) || isNaN(y)) return;
      var z;
      if (w.wp_type === 'well_obs' || w.wp_type === 'well_exp') {
        // Скважина: elev_z — это отметка УСТЬЯ, а не уровня воды. Для изогипс нужна
        // абс. отметка УПВ из истории замеров (глубина до воды), не сама отметка устья.
        var lvl = (typeof RegistryState.wellLevelsLatest === 'object' && RegistryState.wellLevelsLatest) ? RegistryState.wellLevelsLatest[w.id] : null;
        if (!lvl) return; // нет ни одного замера УПВ — не участвует в изогипсах
        z = lvl.elevation;
      } else {
        z = parseFloat(w.elev_z); // для водопроявлений и т.п. elev_z и есть отметка воды/точки
        if (isNaN(z)) return;
      }
      out.push({ id: 'reg:'+w.id, x:x, y:y, z:z, name: w.name || w.code || 'Точка', label: _pit3dWpLabel(w.wp_type) });
    });
  }

  _pit3dActivePoints().forEach(function(p) {
    if (p.xLocal == null || p.yLocal == null) return;
    var z = parseFloat(p.horizon);
    if (isNaN(z)) return;
    out.push({ id: 'pt:'+p.pointNumber, x: p.xLocal, y: p.yLocal, z: z, name: p.pointNumber || 'Точка', label: 'Водопроявление' });
  });

  // Зумпфы "Журнала Водоотлива" — своя, отдельная от реестра база, но с самыми точными и
  // "свежими" данными: реальный уровень ВОДЫ (не отметка дна), замеряемый ежедневно.
  // Координаты у зумпфа появляются, только если их внесли в форме зумпфа (X/Y местной сетки).
  if (typeof DewateringState !== 'undefined' && Array.isArray(DewateringState.sumps)) {
    DewateringState.sumps.forEach(function(s) {
      var x = parseFloat(s.coordX), y = parseFloat(s.coordY);
      if (isNaN(x) || isNaN(y)) return;
      var lvl = DewateringState.latestWaterLevel(s.id);
      if (!lvl) return;
      out.push({ id: 'dsmp:'+s.id, x:x, y:y, z: lvl.elevation, name: s.name || 'Зумпф', label: 'Зумпф (водоотлив)' });
    });
  }

  // Датчики VWP пьезометрических скважин: отметка датчика = Z устья − глубина датчика,
  // абс. отметка воды = отметка датчика + последний замер "уровень над датчиком"
  if (typeof WellsState !== 'undefined' && Array.isArray(WellsState.list)) {
    WellsState.list.forEach(function(w) {
      if (w.wellType !== 'piezometric' || w.xLocal == null || w.yLocal == null || w.zLocal == null) return;
      (w.sensors || []).forEach(function(s) {
        if (s.depth == null) return;
        var reading = (WellsState.sensorReadingsLatest || {})[s.id];
        if (!reading) return;
        var sensorZ = w.zLocal - s.depth;
        var waterZ  = sensorZ + parseFloat(reading.level_above_sensor);
        if (isNaN(waterZ)) return;
        out.push({ id: 'vwp:'+s.id, x: w.xLocal, y: w.yLocal, z: waterZ, name: (s.name || 'Датчик') + ' — ' + (w.name||''), label: 'Пьезометр (VWP)' });
      });
    });
  }

  return out;
}

function _pit3dCollectWaterTablePoints() {
  var excluded = PitModelState.contourExcluded || [];
  return _pit3dAllWaterTableCandidates().filter(function(p) { return excluded.indexOf(p.id) === -1; });
}

// "Красивый" шаг изолиний (1/2/5 × 10^n), чтобы получить ~8-12 линий на весь диапазон отметок
function _pit3dChooseContourStep(zMin, zMax) {
  var range = zMax - zMin;
  if (!(range > 0)) return 1;
  var raw = range / 10;
  var mag  = Math.pow(10, Math.floor(Math.log10(raw)));
  var norm = raw / mag;
  var step = norm < 1.5 ? 1*mag : norm < 3.5 ? 2*mag : norm < 7.5 ? 5*mag : 10*mag;
  return step;
}

// Для одной горизонтальной плоскости Z=level находим все рёбра треугольников TIN,
// пересекающие её, и возвращаем плоский массив координат отрезков [x1,y1,x2,y2,...].
// Соседние треугольники дают отрезки с общими концами — визуально складываются в линию
// без отдельной сборки в полигоны (для карты/3D-вида этого достаточно).
function _pit3dTraceContourSegments(xs, ys, zs, tris, level) {
  var segs = [];
  var numTri = tris.length / 3;
  for (var j = 0; j < numTri; j++) {
    var ia = tris[j*3], ib = tris[j*3+1], ic = tris[j*3+2];
    var za = zs[ia], zb = zs[ib], zc = zs[ic];
    var px = null, py = null, qx = null, qy = null, found = 0;

    if ((za - level) * (zb - level) < 0) {
      var t1 = (level - za) / (zb - za);
      px = xs[ia] + (xs[ib]-xs[ia])*t1; py = ys[ia] + (ys[ib]-ys[ia])*t1; found++;
    }
    if ((zb - level) * (zc - level) < 0) {
      var t2 = (level - zb) / (zc - zb);
      var x2 = xs[ib] + (xs[ic]-xs[ib])*t2, y2 = ys[ib] + (ys[ic]-ys[ib])*t2;
      if (found === 0) { px = x2; py = y2; } else { qx = x2; qy = y2; }
      found++;
    }
    if (found < 2 && (zc - level) * (za - level) < 0) {
      var t3 = (level - zc) / (za - zc);
      var x3 = xs[ic] + (xs[ia]-xs[ic])*t3, y3 = ys[ic] + (ys[ia]-ys[ic])*t3;
      if (found === 0) { px = x3; py = y3; } else { qx = x3; qy = y3; }
      found++;
    }

    if (found === 2 && px != null && qx != null) segs.push(px, py, qx, qy);
  }
  return segs;
}

/* ── Фаза 3: вертикальные разрезы ─────────────────────────────────────────────
   Та же идея, что и для изогипс (_pit3dTraceContourSegments), только вместо
   горизонтальной плоскости Z=level берём вертикальную плоскость, проходящую
   через линию (ax,ay)-(bx,by) — рёбра треугольников проверяются на знак
   расстояния до этой линии, а не на знак (Z-level). Возвращает точки профиля
   {s,z}, где s — расстояние вдоль линии разреза от точки A, отсортированные
   по s (рельеф в разрезе — однозначная функция от s, "нависаний" не бывает). */
function _pit3dSectionProfile(xs, ys, zs, tris, ax, ay, bx, by) {
  var dx = bx-ax, dy = by-ay;
  var L = Math.sqrt(dx*dx+dy*dy) || 1;
  var ux = dx/L, uy = dy/L;

  function side(i) { return dx*(ys[i]-ay) - dy*(xs[i]-ax); }
  function proj(x,y) { return (x-ax)*ux + (y-ay)*uy; }

  var pts = [];
  var numTri = tris.length/3;
  for (var j=0;j<numTri;j++){
    var ia=tris[j*3], ib=tris[j*3+1], ic=tris[j*3+2];
    var da=side(ia), db=side(ib), dc=side(ic);
    var hit = [];

    function edge(i1,i2,d1,d2) {
      if (d1*d2 < 0) {
        var t = d1/(d1-d2);
        var x = xs[i1]+(xs[i2]-xs[i1])*t, y = ys[i1]+(ys[i2]-ys[i1])*t, z = zs[i1]+(zs[i2]-zs[i1])*t;
        hit.push({ s: proj(x,y), z: z });
      }
    }
    edge(ia,ib,da,db); edge(ib,ic,db,dc); edge(ic,ia,dc,da);

    if (hit.length === 2) {
      var s1=hit[0].s, s2=hit[1].s;
      if (s1 >= -1e-6 && s1 <= L+1e-6) pts.push(hit[0]);
      if (s2 >= -1e-6 && s2 <= L+1e-6) pts.push(hit[1]);
    }
  }

  pts.sort(function(a,b){ return a.s - b.s; });
  return { points: pts, length: L };
}

// Выпуклая оболочка точек (алгоритм Эндрю, monotone chain)
function _pit3dConvexHull(pts) {
  var s = pts.slice().sort(function(a,b){ return a.x - b.x || a.y - b.y; });
  function cross(o,a,b){ return (a.x-o.x)*(b.y-o.y) - (a.y-o.y)*(b.x-o.x); }
  var lower = [];
  for (var i=0;i<s.length;i++){
    while (lower.length>=2 && cross(lower[lower.length-2], lower[lower.length-1], s[i])<=0) lower.pop();
    lower.push(s[i]);
  }
  var upper = [];
  for (var j=s.length-1;j>=0;j--){
    while (upper.length>=2 && cross(upper[upper.length-2], upper[upper.length-1], s[j])<=0) upper.pop();
    upper.push(s[j]);
  }
  lower.pop(); upper.pop();
  return lower.concat(upper);
}

function _pit3dPointInPolygon(x, y, poly) {
  var inside = false;
  for (var i=0, j=poly.length-1; i<poly.length; j=i++) {
    var xi=poly[i].x, yi=poly[i].y, xj=poly[j].x, yj=poly[j].y;
    if (((yi>y) !== (yj>y)) && (x < (xj-xi)*(y-yi)/(yj-yi)+xi)) inside = !inside;
  }
  return inside;
}

// Обратно-взвешенная интерполяция (IDW) — Z в произвольной точке по разреженным замерам.
// k ограничивает расчёт ближайшими k точками, а не всеми сразу — иначе далёкие точки с
// совсем другим уровнем воды "утягивают" поверхность даже там, где рядом плотная группа
// согласованных замеров, и между двумя близкими похожими точками появляется вымышленная
// просадка/подъём, которых в реальности нет (например, между 7н и соседними скважинами).
function _pit3dIdwZ(x, y, pts, power, k) {
  var candidates = pts;
  if (k && pts.length > k) {
    candidates = pts.map(function(p) {
      var dx = p.x-x, dy = p.y-y;
      return { p: p, d2: dx*dx+dy*dy };
    }).sort(function(a, b) { return a.d2 - b.d2; }).slice(0, k).map(function(e) { return e.p; });
  }
  var wsum = 0, zsum = 0;
  for (var i=0;i<candidates.length;i++) {
    var dx = candidates[i].x-x, dy = candidates[i].y-y;
    var d2 = dx*dx+dy*dy;
    if (d2 < 1e-6) return candidates[i].z;
    var w = 1/Math.pow(d2, power/2);
    wsum += w; zsum += w*candidates[i].z;
  }
  return wsum > 0 ? zsum/wsum : pts[0].z;
}

// Сколько ближайших точек учитывать при интерполяции сетки — ограничивает "тягу" далёких
// точек с совсем другим уровнем воды (см. _pit3dIdwZ). Подобрано на реальных данных модели:
// при неограниченном IDW между изолированной скважиной 7-н (763 м до ближайшего соседа) и
// соседней ГГ-7 получалась просадка ~80 м (265 вместо честных ~345); при k=6 — уже ~10 м.
var PIT3D_IDW_K = 6;

// Сглаживание изогипс: разреженные замеры (десятки точек) дают угловатый TIN.
// Досыпаем регулярную сетку интерполированных точек внутри выпуклой оболочки реальных
// замеров (за её пределы не выходим — там нет данных, и достраивать нечего) — на такой
// плотной сетке контуры получаются гладкими. Исходные точки остаются в наборе как есть,
// так что в местах реальных замеров поверхность проходит точно через них.
function _pit3dDensifyWaterTable(wtPts) {
  if (wtPts.length < 3) return wtPts;
  var xs = wtPts.map(function(p){return p.x;}), ys = wtPts.map(function(p){return p.y;});
  var xMin=Math.min.apply(null,xs), xMax=Math.max.apply(null,xs);
  var yMin=Math.min.apply(null,ys), yMax=Math.max.apply(null,ys);
  var spanX = xMax-xMin || 1, spanY = yMax-yMin || 1;
  var gridN = 45; // ячеек по большей стороне — компромисс гладкости и скорости
  var cell = Math.max(spanX, spanY) / gridN;
  var nx = Math.max(1, Math.round(spanX/cell)), ny = Math.max(1, Math.round(spanY/cell));
  var hull = _pit3dConvexHull(wtPts);

  var out = wtPts.slice();
  for (var i=0;i<=nx;i++) {
    for (var j=0;j<=ny;j++) {
      var x = xMin + spanX*i/nx, y = yMin + spanY*j/ny;
      if (!_pit3dPointInPolygon(x, y, hull)) continue;
      out.push({ x:x, y:y, z: _pit3dIdwZ(x, y, wtPts, 2, PIT3D_IDW_K) });
    }
  }
  return { points: out, cell: cell };
}

// Отбрасывает треугольники TIN с рёбрами длиннее maxEdge — Делоне на редких/неровных
// точках вдоль края охвата иначе "перекидывает" длинные рёбра через пустые области без
// данных, и трассировка изогипс рисует по ним лишние, ничем не подтверждённые соединения
function _pit3dFilterLongTriangles(xs, ys, triangles, maxEdge) {
  var maxEdge2 = maxEdge * maxEdge;
  function dist2(i, j) { var dx=xs[i]-xs[j], dy=ys[i]-ys[j]; return dx*dx+dy*dy; }
  var out = [];
  var numTri = triangles.length / 3;
  for (var j = 0; j < numTri; j++) {
    var ia = triangles[j*3], ib = triangles[j*3+1], ic = triangles[j*3+2];
    if (dist2(ia,ib) <= maxEdge2 && dist2(ib,ic) <= maxEdge2 && dist2(ic,ia) <= maxEdge2) {
      out.push(ia, ib, ic);
    }
  }
  return Uint32Array.from(out);
}

async function _pit3dBuildContours() {
  var wtPts = _pit3dCollectWaterTablePoints();
  if (wtPts.length < 3) return null;

  var dense = _pit3dDensifyWaterTable(wtPts);
  var densePts = dense.points;
  var tin = await _pit3dBuildTIN(densePts.map(function(p){return p.x;}), densePts.map(function(p){return p.y;}), densePts.map(function(p){return p.z;}));
  // Рёбра длиннее ~2.5 ячейки сетки — заведомо "мост" через область без реальных данных
  tin.triangles = _pit3dFilterLongTriangles(tin.xs, tin.ys, tin.triangles, dense.cell * 2.5);
  var zMin = wtPts[0].z, zMax = wtPts[0].z;
  wtPts.forEach(function(p){ if (p.z < zMin) zMin = p.z; if (p.z > zMax) zMax = p.z; });

  var autoStep = _pit3dChooseContourStep(zMin, zMax);
  PitModelState._lastAutoStep = autoStep;
  var step = (PitModelState.contourStepOverride != null && PitModelState.contourStepOverride > 0) ? PitModelState.contourStepOverride : autoStep;
  var levels = [];
  for (var L = Math.ceil(zMin/step)*step; L <= zMax + 1e-6; L += step) levels.push(Math.round(L*100)/100);

  var byLevel = levels.map(function(level) {
    return { level: level, segs: _pit3dTraceContourSegments(tin.xs, tin.ys, tin.zs, tin.triangles, level) };
  }).filter(function(l) { return l.segs.length > 0; });

  return { points: wtPts, levels: byLevel, step: step, zMin: zMin, zMax: zMax, tin: tin };
}

function _pit3dContourColor(level, zMin, zMax) {
  var t = (zMax > zMin) ? (level - zMin) / (zMax - zMin) : 0.5;
  // Светло-голубой (мелко) → тёмно-синий (глубоко)
  var c1 = { r:0x7d, g:0xd3, b:0xfc }, c2 = { r:0x1e, g:0x3a, b:0x8a };
  var r = Math.round(c1.r + (c2.r-c1.r)*(1-t));
  var g = Math.round(c1.g + (c2.g-c1.g)*(1-t));
  var b = Math.round(c1.b + (c2.b-c1.b)*(1-t));
  return (r<<16) | (g<<8) | b;
}

async function _pit3dToggleContours(checked) {
  PitModelState.layerStyle.isohypses.visible = checked;
  _pit3dSaveLayerStyle();
  var t = PitModelState._three;
  if (!t) return;

  if (checked) {
    if (!PitModelState._contourGroup) {
      _pit3dSetStatus('Построение изогипс подземных вод...');
      var result;
      try { result = await _pit3dBuildContours(); }
      catch (e) { console.error('[pit3d] contour build error', e); result = null; }

      if (!result) {
        _pit3dSetStatus('Недостаточно точек с отметками уровня воды для построения изогипс (нужно минимум 3).', true);
        PitModelState.layerStyle.isohypses.visible = false;
        var cb = document.getElementById('pit3d-layer-vis-isohypses'); if (cb) cb.checked = false;
        return;
      }
      PitModelState._contourData = result;
      _pit3dAddContourGroupToScene(result);
      _pit3dSetStatus('');
      // Обновляем ТОЛЬКО панель статистики — полный _pit3dRenderPanel() пересоздал бы
      // #pit3d-container и оторвал бы уже работающий canvas/анимацию Three.js от DOM
      var statsEl = document.getElementById('pit3d-stats');
      if (statsEl) statsEl.innerHTML = _pit3dStatsHTML();
    }
    if (PitModelState._contourGroup) PitModelState._contourGroup.visible = true;
  } else if (PitModelState._contourGroup) {
    PitModelState._contourGroup.visible = false;
  }
}

function _pit3dAddContourGroupToScene(result) {
  var t = PitModelState._three;
  if (!t || !t.transform) return;
  var tr = t.transform;
  var group = new THREE.Group();
  var op = PitModelState.layerStyle.isohypses.opacity;
  if (op == null) op = 1;

  result.levels.forEach(function(lvl) {
    var color = _pit3dContourColor(lvl.level, result.zMin, result.zMax);
    var positions = new Float32Array(lvl.segs.length / 2 * 3);
    for (var i = 0, k = 0; i < lvl.segs.length; i += 2, k += 3) {
      var x = lvl.segs[i], y = lvl.segs[i+1];
      positions[k]   = (x - tr.cx) * tr.scale;
      positions[k+1] = (lvl.level - tr.cz) * tr.scale;
      positions[k+2] = -(y - tr.cy) * tr.scale;
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    var mat = new THREE.LineBasicMaterial({ color: color, linewidth: 2, transparent: op < 1, opacity: op });
    var line = new THREE.LineSegments(geo, mat);
    line.userData = { isContour: true, level: lvl.level };
    group.add(line);
  });

  t.scene.add(group);
  t.contourGroup = group;
  PitModelState._contourGroup = group;
}

// Полная перестройка изогипс с текущими настройками (шаг / исключённые точки) —
// в отличие от _pit3dToggleContours, всегда пересчитывает заново, не использует кэш
async function _pit3dRebuildContours() {
  var t = PitModelState._three;
  if (t && PitModelState._contourGroup) {
    t.scene.remove(PitModelState._contourGroup);
    PitModelState._contourGroup.children.forEach(function(line) { line.geometry.dispose(); line.material.dispose(); });
  }
  PitModelState._contourGroup = null;
  PitModelState._contourData  = null;

  _pit3dSetStatus('Перестроение изогипс...');
  var result;
  try { result = await _pit3dBuildContours(); }
  catch (e) { console.error('[pit3d] rebuild error', e); result = null; }

  if (!result) {
    _pit3dSetStatus('Недостаточно точек с отметками уровня воды для построения изогипс (нужно минимум 3, с учётом исключённых).', true);
    PitModelState.layerStyle.isohypses.visible = false;
    var cb = document.getElementById('pit3d-layer-vis-isohypses'); if (cb) cb.checked = false;
    var statsEl0 = document.getElementById('pit3d-stats'); if (statsEl0) statsEl0.innerHTML = _pit3dStatsHTML();
    return;
  }

  PitModelState._contourData = result;
  if (t) {
    _pit3dAddContourGroupToScene(result);
    PitModelState._contourGroup.visible = !!PitModelState.layerStyle.isohypses.visible;
  }
  _pit3dSetStatus('');
  var statsEl = document.getElementById('pit3d-stats'); if (statsEl) statsEl.innerHTML = _pit3dStatsHTML();
}

/* ── Настройки изогипс: шаг отрисовки + исключение точек ─────────────────────── */
var _pit3dSettingsPopEl = null;

function _pit3dOpenContourSettings(anchorEl) {
  if (_pit3dSettingsPopEl) { _pit3dCloseContourSettings(); return; }

  var pop = document.createElement('div');
  pop.id = 'pit3d-settings-pop';
  pop.style.cssText = 'position:fixed;z-index:50;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;' +
    'box-shadow:var(--shadow-card);padding:14px;width:280px;max-height:min(70vh,480px);overflow:auto;font-size:12px;color:var(--txt-2)';
  document.body.appendChild(pop);
  _pit3dSettingsPopEl = pop;
  _pit3dRenderSettingsPop();

  var r = anchorEl.getBoundingClientRect();
  var top = r.bottom + 6, left = r.left;
  if (left + 280 > window.innerWidth) left = window.innerWidth - 290;
  if (top + 460 > window.innerHeight) top = Math.max(8, r.top - 466);
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';

  setTimeout(function() { document.addEventListener('click', _pit3dSettingsPopOutsideClick); }, 0);
}

function _pit3dCloseContourSettings() {
  if (_pit3dSettingsPopEl) { _pit3dSettingsPopEl.remove(); _pit3dSettingsPopEl = null; }
  document.removeEventListener('click', _pit3dSettingsPopOutsideClick);
}

function _pit3dSettingsPopOutsideClick(e) {
  if (!_pit3dSettingsPopEl) return;
  // composedPath (а не .contains) — перерисовка попапа заменяет innerHTML прямо во время
  // обработки клика, и кликнутый узел успевает отсоединиться от DOM к моменту проверки
  if (e.composedPath().indexOf(_pit3dSettingsPopEl) === -1) _pit3dCloseContourSettings();
}

function _pit3dRenderSettingsPop() {
  if (!_pit3dSettingsPopEl) return;
  var candidates = _pit3dAllWaterTableCandidates();
  var groups = {};
  candidates.forEach(function(p) { (groups[p.label] = groups[p.label] || []).push(p); });

  var isAuto = PitModelState.contourStepOverride == null;
  var autoHint = PitModelState._lastAutoStep ? (' (сейчас: ' + PitModelState._lastAutoStep + ' м)') : '';

  var html = '<div style="font-weight:700;color:var(--txt-1);margin-bottom:10px">Настройки изогипс</div>';

  html += '<div style="margin-bottom:6px;padding-bottom:10px;border-bottom:1px solid var(--line)">';
  html += '<label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer">' +
    '<input type="radio" name="pit3d-step-mode" ' + (isAuto?'checked':'') + ' onchange="_pit3dSetStepMode(true)"> Автоматический шаг' + autoHint + '</label>';
  html += '<label style="display:flex;align-items:center;gap:6px;cursor:pointer">' +
    '<input type="radio" name="pit3d-step-mode" ' + (!isAuto?'checked':'') + ' onchange="_pit3dSetStepMode(false)"> Свой шаг, м: ' +
    '<input type="number" min="0.1" step="0.1" style="width:64px;background:var(--bg-1);color:var(--txt-1);border:1px solid var(--line);border-radius:4px;padding:2px 5px" ' +
    'value="' + (isAuto ? '' : PitModelState.contourStepOverride) + '" ' + (isAuto?'disabled':'') + ' onchange="_pit3dSetStepValue(this.value)"></label>';
  html += '</div>';

  html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
    '<span style="font-weight:700;color:var(--txt-1)">Точки для расчёта (' + (candidates.length - PitModelState.contourExcluded.length) + ' из ' + candidates.length + ')</span></div>';
  html += '<div style="margin-bottom:8px"><a href="#" style="color:var(--gold);text-decoration:none;font-size:11px" onclick="_pit3dSetAllExcluded(false);return false;">все</a>' +
    ' · <a href="#" style="color:var(--gold);text-decoration:none;font-size:11px" onclick="_pit3dSetAllExcluded(true);return false;">ничего</a></div>';

  if (!candidates.length) {
    html += '<div style="font-size:11px;color:var(--txt-3)">Нет точек с координатами и известной отметкой.</div>';
  }

  Object.keys(groups).sort().forEach(function(label) {
    html += '<div style="font-size:11px;color:var(--txt-3);margin:8px 0 4px">' + escHTML(label) + '</div>';
    groups[label].forEach(function(p) {
      var checked = PitModelState.contourExcluded.indexOf(p.id) === -1;
      html += '<label style="display:flex;align-items:center;gap:6px;padding:2px 0;cursor:pointer">' +
        '<input type="checkbox" ' + (checked?'checked':'') + ' onchange="_pit3dToggleExcluded(\'' + p.id.replace(/'/g,"\\'") + '\', !this.checked)"> ' +
        '<span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escHTML(p.name) + '</span>' +
        '<span style="color:var(--txt-3);flex-shrink:0">' + p.z.toFixed(1) + ' м</span></label>';
    });
  });

  html += '<button class="btn btn-sm btn-primary" style="width:100%;margin-top:12px" onclick="_pit3dApplyContourSettings()">Применить и перестроить</button>';
  _pit3dSettingsPopEl.innerHTML = html;
}

function _pit3dSetStepMode(auto) {
  PitModelState.contourStepOverride = auto ? null : (PitModelState._lastAutoStep || 5);
  _pit3dRenderSettingsPop();
}
function _pit3dSetStepValue(v) {
  var n = parseFloat(v);
  if (!isNaN(n) && n > 0) PitModelState.contourStepOverride = n;
}
function _pit3dToggleExcluded(id, excluded) {
  var arr = PitModelState.contourExcluded;
  var idx = arr.indexOf(id);
  if (excluded && idx === -1) arr.push(id);
  if (!excluded && idx !== -1) arr.splice(idx, 1);
  _pit3dRenderSettingsPop();
}
function _pit3dSetAllExcluded(excludeAll) {
  PitModelState.contourExcluded = excludeAll ? _pit3dAllWaterTableCandidates().map(function(p){ return p.id; }) : [];
  _pit3dRenderSettingsPop();
}

async function _pit3dApplyContourSettings() {
  _pit3dSaveStep();
  _pit3dSaveExcluded();
  _pit3dCloseContourSettings();
  PitModelState.layerStyle.isohypses.visible = true;
  var cb = document.getElementById('pit3d-layer-vis-isohypses'); if (cb) cb.checked = true;
  await _pit3dRebuildContours();
}

/* ── 3D-сцена (Three.js) ──────────────────────────────────────────────────────
   Переиспользуем загрузчик _sfLoadThree() из "Прогноз зумпфов" — он лениво
   подключает Three.js r128 + OrbitControls с CDN и уже проверен в этой системе. */
function _pit3dDestroy3D() {
  var t = PitModelState._three;
  if (!t) return;
  if (t.animId) cancelAnimationFrame(t.animId);
  if (t.resizeObserver) t.resizeObserver.disconnect();
  if (t.renderer) { t.renderer.dispose(); t.renderer.domElement.remove(); }
  PitModelState._three = null;
  PitModelState._contourGroup = null; // группа принадлежала старой сцене — пересоберём при следующем включении
  PitModelState._sectionPickGroup = null;
}

function _pit3dInit3D() {
  _pit3dDestroy3D();
  var container = document.getElementById('pit3d-container');
  if (!container || !window.THREE || !PitModelState.xs) return;

  var W = container.clientWidth || 480, H3 = container.clientHeight || 600;

  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(W, H3);
  renderer.setClearColor(0x0d1117, 1);
  container.innerHTML = '';
  container.style.position = 'relative';
  container.appendChild(renderer.domElement);

  var scene = new THREE.Scene();
  scene.add(new THREE.AmbientLight(0xffffff, 0.65));
  var dirLight = new THREE.DirectionalLight(0xffffff, 0.85);
  dirLight.position.set(1, 2, 3);
  scene.add(dirLight);

  var xs = PitModelState.xs, ys = PitModelState.ys, zs = PitModelState.zs, tri = PitModelState.triangles;
  // Центр/масштаб считаем по устойчивому охвату (без единичных выбросов) — иначе редкая
  // точка далеко в стороне превращает модель в нечитаемую тонкую полоску
  var b = PitModelState.robustBBox || PitModelState.bbox;
  var cx = (b.xMin+b.xMax)/2, cy = (b.yMin+b.yMax)/2, cz = (b.zMin+b.zMax)/2;
  var span  = Math.max(b.xMax-b.xMin, b.yMax-b.yMin, b.zMax-b.zMin) || 1;
  var scale = 80 / span;

  // Каркас — маппинг осей: маркшейдерский X→Three X, Y→Three -Z, Z(высота)→Three Y
  var numTri = tri.length / 3;
  var positions = new Float32Array(numTri * 9);
  for (var j = 0; j < numTri; j++) {
    var i0 = tri[j*3], i1 = tri[j*3+1], i2 = tri[j*3+2];
    positions[j*9+0]=(xs[i0]-cx)*scale; positions[j*9+1]=(zs[i0]-cz)*scale; positions[j*9+2]=-(ys[i0]-cy)*scale;
    positions[j*9+3]=(xs[i1]-cx)*scale; positions[j*9+4]=(zs[i1]-cz)*scale; positions[j*9+5]=-(ys[i1]-cy)*scale;
    positions[j*9+6]=(xs[i2]-cx)*scale; positions[j*9+7]=(zs[i2]-cz)*scale; positions[j*9+8]=-(ys[i2]-cy)*scale;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geo.computeVertexNormals();

  var op = PitModelState.terrainOpacity != null ? PitModelState.terrainOpacity : 1;
  var solidMat = new THREE.MeshPhongMaterial({
    color: 0x8a7256, side: THREE.DoubleSide, flatShading: true,
    transparent: op < 1, opacity: op, depthWrite: op >= 0.999,
  });
  var mesh = new THREE.Mesh(geo, solidMat);
  scene.add(mesh);

  var edgeMat = new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.15 });
  var wireframe = new THREE.LineSegments(new THREE.WireframeGeometry(geo), edgeMat);
  wireframe.visible = PitModelState.showWireframe;
  scene.add(wireframe);

  var markerR = Math.max(span * scale * 0.006, 0.6);

  var camera = new THREE.PerspectiveCamera(45, W / H3, 0.1, 5000);
  var d = span * scale;
  camera.position.set(d * 0.9, d * 0.85, d * 1.1);
  camera.lookAt(0, 0, 0);

  var controls = new THREE.OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minDistance = 5;
  controls.maxDistance = d * 5;
  // Перемещение (пан) правой кнопкой мыши — screenSpacePanning двигает камеру вместе с
  // целью прямо по экранной плоскости (интуитивнее, чем панорамирование вдоль плоскости XZ мира)
  controls.enablePan = true;
  controls.screenSpacePanning = true;
  controls.panSpeed = 0.8;
  renderer.domElement.addEventListener('contextmenu', function(e) { e.preventDefault(); });

  PitModelState._three = {
    renderer: renderer, scene: scene, camera: camera, controls: controls,
    mesh: mesh, wireframe: wireframe, markerGroup: null, wellsGroup: null, markerR: markerR,
    resizeObserver: null, animId: null, initialCamPos: camera.position.clone(),
    transform: { cx: cx, cy: cy, cz: cz, scale: scale },
  };
  _pit3dRebuildMarkerGroup();
  _pit3dRebuildWellsGroup();

  // Подсказка при наведении на точку мониторинга/изогипсу
  var tooltip = document.createElement('div');
  tooltip.style.cssText = 'position:absolute;pointer-events:none;background:rgba(10,14,22,0.94);color:#e2e8f0;font-size:11px;line-height:1.5;padding:6px 9px;border-radius:6px;border:1px solid rgba(255,255,255,0.12);display:none;z-index:5;white-space:nowrap';
  var tooltipText = document.createElement('div');
  tooltip.appendChild(tooltipText);
  // Фото водопроявления (по активной дате/неделе — те же photoUrls, что собрал _pit3dCollectMonitoringPoints)
  var tooltipImg = document.createElement('img');
  tooltipImg.style.cssText = 'display:none;max-width:170px;max-height:120px;border-radius:5px;margin-top:6px;object-fit:cover';
  tooltipImg.onerror = function() { tooltipImg.style.display = 'none'; }; // битая/удалённая ссылка на фото — не показываем "сломанную картинку"
  tooltip.appendChild(tooltipImg);
  var tooltipPhotoKey = null;
  container.appendChild(tooltip);

  var raycaster = new THREE.Raycaster();
  raycaster.params.Line = { threshold: markerR * 0.6 };
  var mouse = new THREE.Vector2();
  renderer.domElement.addEventListener('mousemove', function(e) {
    var rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    // Группа маркеров читается динамически (не из замыкания) — переживает _pit3dRebuildMarkerGroup()
    var mg = PitModelState._three ? PitModelState._three.markerGroup : null;
    var hits = (mg && mg.visible) ? raycaster.intersectObjects(mg.children) : [];
    if (hits.length) {
      var p = hits[0].object.userData;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
      tooltip.style.top  = (e.clientY - rect.top  + 14) + 'px';
      tooltipText.innerHTML = '<b>' + escHTML(p.name) + '</b><br>' + escHTML(p.label) + '<br>Z ≈ ' + p.z.toFixed(1) + ' м';
      var photoUrl = (p.layerKey === 'points' && Array.isArray(p.photoUrls) && p.photoUrls.length) ? p.photoUrls[0] : null;
      if (photoUrl) {
        if (tooltipPhotoKey !== photoUrl) { tooltipPhotoKey = photoUrl; Photos.setImageSrc(tooltipImg, photoUrl); }
        tooltipImg.style.display = 'block';
      } else {
        tooltipPhotoKey = null;
        tooltipImg.style.display = 'none';
      }
      return;
    }
    tooltipPhotoKey = null;
    tooltipImg.style.display = 'none';
    var wg = PitModelState._three ? PitModelState._three.wellsGroup : null;
    var wHits = (wg && wg.visible) ? raycaster.intersectObjects(wg.children) : [];
    if (wHits.length) {
      var wd = wHits[0].object.userData;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
      tooltip.style.top  = (e.clientY - rect.top  + 14) + 'px';
      tooltipText.innerHTML = '<b>' + escHTML(wd.name) + '</b><br>' + escHTML(wd.label) +
        (wd.extra ? '<br>' + escHTML(wd.extra) : '') + '<br>Z ≈ ' + wd.z.toFixed(1) + ' м';
      return;
    }
    var cg = PitModelState._contourGroup;
    var cHits = (cg && cg.visible) ? raycaster.intersectObjects(cg.children) : [];
    if (cHits.length) {
      var lvl = cHits[0].object.userData.level;
      tooltip.style.display = 'block';
      tooltip.style.left = (e.clientX - rect.left + 14) + 'px';
      tooltip.style.top  = (e.clientY - rect.top  + 14) + 'px';
      tooltipText.innerHTML = '<b>Изогипса</b><br>' + lvl.toFixed(1) + ' м';
      return;
    }
    tooltip.style.display = 'none';
  });

  // Клик по модели — задаёт точки A/B линии разреза (Фаза 3), только в режиме "picking".
  // Слушаем pointerdown/pointerup, а не mousedown/mouseup: OrbitControls (r128) сама работает
  // через Pointer Events и вызывает preventDefault() на pointerdown — по спецификации это
  // подавляет последующую синтезацию совместимых mousedown/mouseup, и обычный обработчик
  // mousedown на реальных кликах вообще не получал бы события (мышь "не реагирует").
  var _secMouseDown = null;
  renderer.domElement.addEventListener('pointerdown', function(e) { _secMouseDown = { x: e.clientX, y: e.clientY }; });
  renderer.domElement.addEventListener('pointerup', function(e) {
    var down = _secMouseDown; _secMouseDown = null;
    if (!PitModelState.sectionPicking || !down) return;
    if (Math.hypot(e.clientX - down.x, e.clientY - down.y) >= 12) return; // это было вращение, не клик
    var rect = renderer.domElement.getBoundingClientRect();
    mouse.x =  ((e.clientX - rect.left) / rect.width)  * 2 - 1;
    mouse.y = -((e.clientY - rect.top)  / rect.height) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);
    var hits = raycaster.intersectObject(mesh);
    if (!hits.length) return;
    var lp = hits[0].point;
    var tr = PitModelState._three.transform;
    _pit3dHandleSectionClick(lp.x/tr.scale + tr.cx, tr.cy - lp.z/tr.scale);
  });

  function animate() {
    var id = requestAnimationFrame(animate);
    PitModelState._three.animId = id;
    var page = document.getElementById('page-pit3d');
    if (page && !page.classList.contains('active')) return; // не тратим ресурсы на скрытой вкладке
    controls.update();
    renderer.render(scene, camera);
  }

  var ro = new ResizeObserver(function() {
    if (!PitModelState._three) return;
    var nw = container.clientWidth, nh = container.clientHeight || nw;
    if (!nw || !nh) return;
    camera.aspect = nw / nh;
    camera.updateProjectionMatrix();
    renderer.setSize(nw, nh);
  });
  ro.observe(container);
  PitModelState._three.resizeObserver = ro;

  animate();

  // Если изогипсы уже были построены (например, при повторной инициализации сцены) — добавляем их снова
  if (PitModelState._contourData) {
    _pit3dAddContourGroupToScene(PitModelState._contourData);
    PitModelState._contourGroup.visible = !!PitModelState.layerStyle.isohypses.visible;
  }
}

// Смена фильтра "неделя" для точек водопроявлений — перестраивает маркеры и (если уже
// были построены) изогипсы, чтобы обе вещи консистентно отражали выбранную неделю
async function _pit3dSetWeekFilter(val) {
  PitModelState.pointsWeekFilter = val || null;
  _pit3dRebuildMarkerGroup();
  if (PitModelState._contourData) await _pit3dRebuildContours();
  var statsEl = document.getElementById('pit3d-stats');
  if (statsEl) statsEl.innerHTML = _pit3dStatsHTML();
}

function _pit3dToggleWireframe(checked) {
  PitModelState.showWireframe = checked;
  var t = PitModelState._three;
  if (t && t.wireframe) t.wireframe.visible = checked;
}

// Прозрачность сплошной поверхности рельефа (0..1) — чтобы видеть изогипсы,
// проходящие "внутри"/с обратной стороны модели, не скрытые непрозрачным рельефом
function _pit3dSetTerrainOpacity(val) {
  var v = parseFloat(val);
  if (isNaN(v)) return;
  v = Math.max(0, Math.min(1, v));
  PitModelState.terrainOpacity = v;
  var t = PitModelState._three;
  if (!t || !t.mesh) return;
  var mat = t.mesh.material;
  mat.opacity = v;
  mat.transparent = v < 1;
  mat.depthWrite = v >= 0.999;
}

function _pit3dResetView() {
  var t = PitModelState._three;
  if (!t) return;
  t.camera.position.copy(t.initialCamPos);
  t.camera.lookAt(0, 0, 0);
  t.controls.target.set(0, 0, 0);
  t.controls.update();
}

async function _pit3dTryRender3D() {
  try {
    _pit3dSetStatus('Загрузка 3D-движка...');
    await _sfLoadThree();
    _pit3dInit3D();
    _pit3dSetStatus('');
  } catch (e) {
    console.warn('[pit3d] 3D render unavailable:', e.message);
    _pit3dSetStatus('3D-просмотр недоступен: ' + e.message, true);
  }
}

/* ── Разметка вкладки ─────────────────────────────────────────────────────────── */
function _pit3dSetStatus(msg, err) {
  var el = document.getElementById('pit3d-status');
  if (!el) return;
  el.textContent = msg || '';
  el.style.color = err ? 'var(--bad)' : 'var(--txt-2)';
}

function _pit3dStatsHTML() {
  var b = PitModelState.bbox;
  function row(label, val) {
    return '<div style="display:flex;justify-content:space-between;gap:8px;margin-bottom:6px"><span>' + label + '</span>' +
      '<span style="color:var(--txt-1);font-weight:600;text-align:right">' + val + '</span></div>';
  }
  var html = '<div style="font-weight:700;color:var(--txt-1);margin-bottom:10px">Модель рельефа</div>';
  html += row('Файл', escHTML(PitModelState.fileName || '—'));
  html += row('Стринги', PitModelState.stringerCount.toLocaleString('ru-RU'));
  html += row('Вершины', PitModelState.vertexCount.toLocaleString('ru-RU'));
  html += row('Треугольники TIN', PitModelState.triCount.toLocaleString('ru-RU'));
  if (b) {
    html += row('Z мин / макс', b.zMin.toFixed(1) + ' / ' + b.zMax.toFixed(1) + ' м');
    html += row('Размер X×Y', Math.round(b.xMax-b.xMin).toLocaleString('ru-RU') + ' × ' + Math.round(b.yMax-b.yMin).toLocaleString('ru-RU') + ' м');
  }
  if (PitModelState.outlierCount) {
    html += '<div style="font-size:11px;color:var(--warn);margin-top:8px;line-height:1.5">⚠ ' + PitModelState.outlierCount.toLocaleString('ru-RU') +
      ' точек лежат далеко за пределами основного массива (возможно, отдельный объект в файле). ' +
      'Вид и масштаб построены по основному скоплению точек — эти данные не потеряны, но могут быть не видны в исходном ракурсе.</div>';
  }

  var pts = _pit3dCollectMonitoringPoints();
  html += '<div style="font-weight:700;color:var(--txt-1);margin:16px 0 8px">Точки на модели</div>';
  html += row('Неделя', PitModelState.pointsWeekFilter ? _pit3dWeekLabel(PitModelState.pointsWeekFilter) : 'последние данные');
  html += row('Всего в границах', pts.length);
  var byLabel = {};
  pts.forEach(function(p) { byLabel[p.label] = (byLabel[p.label]||0) + 1; });
  Object.keys(byLabel).sort().forEach(function(k) { html += row(k, byLabel[k]); });
  if (!pts.length) {
    html += '<div style="font-size:11px;color:var(--txt-3);margin-top:6px">Нет точек реестра/списка точек с координатами внутри границ модели.</div>';
  }

  html += '<div style="margin-top:16px;padding-top:12px;border-top:1px solid var(--line);font-size:11px;color:var(--txt-3)">' +
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#60a5fa;margin-right:5px"></span>Реестр водопунктов<br>' +
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#22d3ee;margin-right:5px;margin-top:4px"></span>Список точек (водопроявления)<br>' +
    '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#fb923c;margin-right:5px;margin-top:4px"></span>Зумпфы (Журнал Водоотлива)' +
  '</div>';

  var cd = PitModelState._contourData;
  if (cd) {
    html += '<div style="font-weight:700;color:var(--txt-1);margin:16px 0 8px">Изогипсы подземных вод</div>';
    html += row('По точкам', cd.points.length);
    html += row('Шаг', cd.step + ' м');
    html += row('Линий', cd.levels.length);
    html += row('Диапазон', cd.zMin.toFixed(1) + ' – ' + cd.zMax.toFixed(1) + ' м');
    html += '<div style="font-size:11px;color:var(--txt-3);margin-top:6px;line-height:1.5">Построены по ' + cd.points.length +
      ' точкам с известной отметкой уровня воды — при малом числе точек изогипсы приблизительные.</div>';
  } else {
    var wtCount = _pit3dCollectWaterTablePoints().length;
    html += '<div style="font-weight:700;color:var(--txt-1);margin:16px 0 8px">Изогипсы подземных вод</div>';
    html += '<div style="font-size:11px;color:var(--txt-3);line-height:1.5">Доступно точек с отметкой: ' + wtCount +
      '. Включите «Изогипсы» в панели сверху, чтобы построить.</div>';
  }

  return html;
}

function _pit3dWeekSelectHTML() {
  var weeks = _pit3dAvailableWeeks();
  if (!weeks.length) return '';
  var cur = PitModelState.pointsWeekFilter || '';
  var html = '<select id="pit3d-week-select" title="Показать точки водопроявлений за выбранную неделю" ' +
    'style="font-size:12px;background:var(--bg-1);color:var(--txt-2);border:1px solid var(--line);border-radius:5px;padding:4px 6px" ' +
    'onchange="_pit3dSetWeekFilter(this.value)">';
  html += '<option value=""' + (cur===''?' selected':'') + '>Неделя: последние данные</option>';
  weeks.forEach(function(w) {
    html += '<option value="' + w + '"' + (cur===w?' selected':'') + '>' + _pit3dWeekLabel(w) + '</option>';
  });
  html += '</select>';
  return html;
}

function _pit3dRenderPanel() {
  var root = document.getElementById('pit3d-content');
  if (!root) return;

  var html = '<div style="display:flex;align-items:center;gap:12px;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap">';
  html += '<label class="btn btn-sm" style="cursor:pointer;margin:0">📁 ' + (PitModelState.loaded ? 'Загрузить другой DXF' : 'Загрузить DXF') +
          '<input type="file" accept=".dxf" style="display:none" onchange="_pit3dOnFileInput(event)"' + (PitModelState.loading ? ' disabled' : '') + '></label>';

  if (PitModelState.loaded) {
    html += '<label style="display:flex;align-items:center;gap:5px;font-size:12px;color:var(--txt-2);cursor:pointer">' +
      '<input type="checkbox" id="pit3d-wireframe" ' + (PitModelState.showWireframe?'checked':'') + ' onchange="_pit3dToggleWireframe(this.checked)"> Каркас</label>';
    (function() {
      var transp = Math.round((1 - PitModelState.terrainOpacity) * 100);
      html += '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--txt-2)" title="Прозрачность поверхности рельефа — чтобы видеть изогипсы сквозь модель">' +
        'Прозрачность' +
        '<input type="range" min="0" max="100" value="' + transp + '" style="width:80px;vertical-align:middle" ' +
        'oninput="_pit3dSetTerrainOpacity(1-this.value/100); document.getElementById(\'pit3d-opacity-val\').textContent=this.value+\'%\'">' +
        '<span id="pit3d-opacity-val" style="min-width:34px;color:var(--txt-3)">' + transp + '%</span>' +
      '</label>';
    })();
    html += _pit3dWeekSelectHTML();
    html += '<button class="btn btn-sm btn-outline" title="Настройки изогипс: шаг, исключение точек" onclick="_pit3dOpenContourSettings(this)">⚙ Изогипсы</button>';
    html += '<button class="btn btn-sm" onclick="_pit3dResetView()">⟲ Сброс вида</button>';
    html += '<button class="btn btn-sm btn-outline" id="pit3d-section-btn" title="Кликните две точки на модели, чтобы построить вертикальный разрез" onclick="_pit3dStartSectionPicking()">✂ Разрез</button>';
    html += '<button class="btn btn-sm btn-outline" id="pit3d-sections-list-btn" onclick="_pit3dOpenSectionsList(this)">📋 Разрезы (' + PitModelState.savedSections.length + ')</button>';
    html += '<button class="btn btn-sm btn-outline" onclick="_pit3dClearModel()">🗑 Удалить модель</button>';
  }

  html += '<span id="pit3d-status" style="font-size:12px;color:var(--txt-2);margin-left:auto"></span>';
  html += '</div>';

  if (!PitModelState.loaded) {
    html += '<div style="flex:1;display:flex;align-items:center;justify-content:center;color:var(--txt-2);font-size:13px;text-align:center;padding:40px">' +
      '<div>Загрузите файл DXF со стрингами рельефа карьера (POLYLINE/VERTEX),<br>чтобы построить 3D-модель.<br><br>' +
      '<span style="font-size:11px;color:var(--txt-3)">Парсинг больших файлов (десятки МБ) может занять до минуты — окно временно не будет отвечать, это нормально.</span></div></div>';
  } else {
    // flex:1 + overflow-y:auto — модель занимает фиксированную высоту (60vh), а панель
    // "Слои" остаётся доступна прокруткой ниже, как и попросил пользователь
    html += '<div style="flex:1;display:flex;flex-direction:column;overflow-y:auto;min-height:0">';
    html += '<div style="height:60vh;min-height:420px;flex-shrink:0;display:flex">';
    html += '<div id="pit3d-container" style="flex:1;position:relative;min-width:0"></div>';
    html += '<div id="pit3d-stats" style="width:230px;flex-shrink:0;padding:14px;font-size:12px;color:var(--txt-2);border-left:1px solid var(--line);overflow:auto">' + _pit3dStatsHTML() + '</div>';
    html += '</div>';
    html += '<div id="pit3d-layers-panel" style="flex-shrink:0">' + _pit3dLayersPanelHTML() + '</div>';
    html += '</div>';
  }

  root.innerHTML = html;
}

/* ── Панель "Слои": видимость/цвет/геометрия/прозрачность каждого слоя + таблица ── */
function _pit3dGeomLabel(g) {
  return { sphere: 'Сфера', cube: 'Куб', cone: 'Конус', diamond: 'Ромб' }[g] || g;
}

function _pit3dLayerRowHTML(def) {
  var st = PitModelState.layerStyle[def.key] || {};
  var vis = !!st.visible;
  var html = '<div style="display:flex;align-items:center;gap:14px;padding:7px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap">';
  html += '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--txt-2);cursor:pointer;min-width:220px">' +
    '<input type="checkbox" id="pit3d-layer-vis-' + def.key + '" ' + (vis ? 'checked' : '') +
    ' onchange="_pit3dSetLayerVisible(\'' + def.key + '\', this.checked)"> ' + escHTML(def.label) + '</label>';

  if (def.special) {
    html += '<span style="font-size:11px;color:var(--txt-3);min-width:150px">линии по уровням воды</span>';
  } else {
    html += '<input type="color" value="' + (st.color || '#999999') + '" title="Цвет маркера" ' +
      'onchange="_pit3dSetLayerColor(\'' + def.key + '\', this.value)" ' +
      'style="width:28px;height:24px;border:1px solid var(--line);border-radius:4px;background:none;cursor:pointer;padding:0">';
    html += '<select title="Форма маркера" onchange="_pit3dSetLayerGeometry(\'' + def.key + '\', this.value)" ' +
      'style="font-size:11px;background:var(--bg-1);color:var(--txt-2);border:1px solid var(--line);border-radius:4px;padding:3px 5px">';
    ['sphere', 'cube', 'cone', 'diamond'].forEach(function(g) {
      html += '<option value="' + g + '"' + (st.geometry === g ? ' selected' : '') + '>' + _pit3dGeomLabel(g) + '</option>';
    });
    html += '</select>';
    var sz = st.size != null ? st.size : 1;
    html += '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--txt-3)">Размер' +
      '<input type="range" min="0.3" max="3" step="0.1" value="' + sz + '" style="width:70px;vertical-align:middle" ' +
      'oninput="_pit3dSetLayerSize(\'' + def.key + '\', this.value); document.getElementById(\'pit3d-size-val-' + def.key + '\').textContent=(+this.value).toFixed(1)+\'×\'">' +
      '<span id="pit3d-size-val-' + def.key + '" style="min-width:28px;display:inline-block">' + sz.toFixed(1) + '×</span></span>';
  }

  var op = st.opacity != null ? st.opacity : 1;
  html += '<span style="display:flex;align-items:center;gap:5px;font-size:11px;color:var(--txt-3)">Прозрачность' +
    '<input type="range" min="0" max="100" value="' + Math.round(op * 100) + '" style="width:70px;vertical-align:middle" ' +
    'oninput="_pit3dSetLayerOpacity(\'' + def.key + '\', this.value/100); document.getElementById(\'pit3d-op-val-' + def.key + '\').textContent=this.value+\'%\'">' +
    '<span id="pit3d-op-val-' + def.key + '" style="min-width:30px;display:inline-block">' + Math.round(op * 100) + '%</span></span>';

  html += '<button class="btn btn-sm btn-outline" style="margin-left:auto" onclick="_pit3dOpenLayerTable(\'' + def.key + '\')">📋 Таблица</button>';
  html += '</div>';
  return html;
}

function _pit3dLayersPanelHTML() {
  var html = '<div style="border-top:1px solid var(--line)">';
  html += '<div style="padding:10px 16px;font-weight:700;color:var(--txt-1);font-size:13px;border-bottom:1px solid var(--line)">Слои</div>';
  var lastGroup = null;
  PIT3D_LAYER_DEFS.forEach(function(def) {
    if (def.group && def.group !== lastGroup) {
      lastGroup = def.group;
      html += '<div style="padding:6px 16px 2px;font-size:10px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--txt-3)">' + escHTML(def.group) + '</div>';
    }
    html += _pit3dLayerRowHTML(def);
  });
  html += '</div>';
  return html;
}

function _pit3dLayerTableRows(key) {
  if (key === 'isohypses') {
    return (typeof _pit3dAllWaterTableCandidates === 'function' ? _pit3dAllWaterTableCandidates() : [])
      .map(function(p) { return { name: p.name, label: p.label, x: p.x, y: p.y, z: p.z }; });
  }
  if (key === 'wells_drainage' || key === 'wells_piezo') {
    var isPiezo = key === 'wells_piezo';
    return _pit3dCollectWellTrajectories()
      .filter(function(w) { return w.isPiezo === isPiezo; })
      .map(function(w) {
        var extra = [];
        if (w.depth != null) extra.push(w.depth + ' м');
        if (w.azimuth != null) extra.push('аз. ' + w.azimuth + '°');
        if (w.inclination != null) extra.push('накл. ' + w.inclination + '°');
        var label = (isPiezo ? 'Пьезометрическая' : 'Дренажная') + (extra.length ? ' · ' + extra.join(', ') : '');
        return { name: w.name, label: label, x: w.collar.x, y: w.collar.y, z: w.collar.z };
      });
  }
  return _pit3dCollectMonitoringPoints(true)
    .filter(function(p) { return p.layerKey === key; })
    .map(function(p) { return { name: p.name, label: p.label, x: p.x, y: p.y, z: p.z }; });
}

function _pit3dOpenLayerTable(key) {
  var def = PIT3D_LAYER_DEFS.filter(function(d) { return d.key === key; })[0];
  var rows = _pit3dLayerTableRows(key);

  var existing = document.getElementById('pit3d-layer-table-modal');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'pit3d-layer-table-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center;padding:24px';

  var modal = document.createElement('div');
  modal.style.cssText = 'width:min(640px,95%);max-height:min(600px,90%);display:flex;flex-direction:column;background:var(--bg-2);border-radius:10px;overflow:hidden;box-shadow:var(--shadow-card)';

  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line)';
  hdr.innerHTML =
    '<div style="font-weight:700;color:var(--txt-1);font-size:13px">' + escHTML(def ? def.label : key) + ' — ' + rows.length + '</div>' +
    '<button id="pit3d-lt-close" style="background:none;border:none;color:var(--txt-2);font-size:18px;cursor:pointer;padding:2px 8px">✕</button>';
  modal.appendChild(hdr);

  var body = document.createElement('div');
  body.style.cssText = 'flex:1;overflow:auto;padding:0 4px';
  var t = '<table style="width:100%;border-collapse:collapse;font-size:12px">' +
    '<thead><tr style="text-align:left;color:var(--txt-3)">' +
    '<th style="padding:7px 12px">Название</th><th style="padding:7px 12px">Тип</th>' +
    '<th style="padding:7px 12px">X</th><th style="padding:7px 12px">Y</th><th style="padding:7px 12px">Z</th></tr></thead><tbody>';
  if (!rows.length) {
    t += '<tr><td colspan="5" style="padding:14px 12px;color:var(--txt-3)">Нет данных для этого слоя.</td></tr>';
  } else {
    rows.forEach(function(r) {
      t += '<tr style="border-top:1px solid var(--line)">' +
        '<td style="padding:6px 12px;color:var(--txt-1)">' + escHTML(r.name || '') + '</td>' +
        '<td style="padding:6px 12px;color:var(--txt-3)">' + escHTML(r.label || '') + '</td>' +
        '<td style="padding:6px 12px;font-variant-numeric:tabular-nums">' + (r.x != null ? r.x.toFixed(2) : '—') + '</td>' +
        '<td style="padding:6px 12px;font-variant-numeric:tabular-nums">' + (r.y != null ? r.y.toFixed(2) : '—') + '</td>' +
        '<td style="padding:6px 12px;font-variant-numeric:tabular-nums">' + (r.z != null ? r.z.toFixed(2) : '—') + '</td>' +
      '</tr>';
    });
  }
  t += '</tbody></table>';
  body.innerHTML = t;
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() { overlay.remove(); document.removeEventListener('keydown', onKey); }
  function onKey(e) { if (e.key === 'Escape') close(); }
  document.getElementById('pit3d-lt-close').onclick = close;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });
  document.addEventListener('keydown', onKey);
}

async function initPit3DTab() {
  // Реестр водопунктов может быть ещё не загружен, если пользователь не открывал эту вкладку
  if (typeof RegistryState !== 'undefined' && !RegistryState.loaded && !RegistryState.loading && typeof RegistryApi !== 'undefined') {
    RegistryState.loading = true;
    try {
      var res = await RegistryApi.getAll();
      if (!res.error) RegistryState.items = res.data || [];
    } catch (e) { console.warn('[pit3d] registry load failed', e); }
    RegistryState.loaded  = true;
    RegistryState.loading = false;
  }
  if (typeof _regLoadAllWellLevelsLatest === 'function') {
    try { await _regLoadAllWellLevelsLatest(); } catch (e) { console.warn('[pit3d] well levels load failed', e); }
  }

  // Зумпфы и уровни воды "Журнала Водоотлива" — своя база, тоже может быть не загружена,
  // если пользователь ещё не открывал эту вкладку в текущей сессии
  if (typeof DewateringState !== 'undefined' && !PitModelState._dewChecked) {
    PitModelState._dewChecked = true;
    try { DewateringState.load(); await DewateringState.loadFromSupabase(); }
    catch (e) { console.warn('[pit3d] dewatering load failed', e); }
  }

  // Горизонтальные/пьезометрические скважины (WellsState) — тоже может быть не загружено
  if (typeof WellsState !== 'undefined' && !WellsState.list.length && !PitModelState._wellsChecked) {
    PitModelState._wellsChecked = true;
    await new Promise(function(resolve) {
      try { initWellsModule(resolve); } catch (e) { console.warn('[pit3d] wells load failed', e); resolve(); }
    });
  }
  if (typeof _wellsLoadAllSensorReadingsLatest === 'function') {
    try { await _wellsLoadAllSensorReadingsLatest(); } catch (e) { console.warn('[pit3d] sensor readings load failed', e); }
  }

  if (!PitModelState.loaded && !PitModelState._dbChecked) {
    PitModelState._dbChecked = true;
    try {
      var rec = await _pit3dDbLoad();
      if (rec && rec.xs && rec.xs.length) {
        PitModelState.xs = rec.xs; PitModelState.ys = rec.ys; PitModelState.zs = rec.zs;
        PitModelState.triangles     = rec.triangles;
        PitModelState.bbox          = rec.bbox;
        PitModelState.robustBBox    = rec.robustBBox || rec.bbox;
        PitModelState.outlierCount  = rec.outlierCount || 0;
        PitModelState.stringerCount = rec.stringerCount;
        PitModelState.vertexCount   = rec.vertexCount;
        PitModelState.triCount      = rec.triangles.length / 3;
        PitModelState.fileName      = rec.fileName;
        PitModelState.uploadedAt    = rec.uploadedAt;
        PitModelState.loaded        = true;
      }
    } catch (e) { console.warn('[pit3d] IndexedDB load failed', e); }
  }

  try { PitModelState.savedSections = await _pit3dSectionsLoadAll(); } catch (e) { console.warn('[pit3d] sections load failed', e); }

  _pit3dRenderPanel();
  if (PitModelState.loaded) await _pit3dTryRender3D();
}

/* ── Фаза 3, UI: выбор линии разреза на модели, метки, линия ─────────────────── */
function _pit3dClearSectionPickMarkers() {
  var t = PitModelState._three;
  if (t && PitModelState._sectionPickGroup) {
    t.scene.remove(PitModelState._sectionPickGroup);
    PitModelState._sectionPickGroup.children.forEach(function(o) { o.geometry.dispose(); o.material.dispose(); });
  }
  PitModelState._sectionPickGroup = null;
}

function _pit3dEnsureSectionPickGroup() {
  var t = PitModelState._three;
  if (!t) return null;
  if (!PitModelState._sectionPickGroup) {
    var g = new THREE.Group();
    t.scene.add(g);
    PitModelState._sectionPickGroup = g;
  }
  return PitModelState._sectionPickGroup;
}

function _pit3dWorldToLocal(x, y, z) {
  var tr = PitModelState._three.transform;
  return { x: (x-tr.cx)*tr.scale, y: (z-tr.cz)*tr.scale, z: -(y-tr.cy)*tr.scale };
}

function _pit3dAddSectionMarker(x, y, color) {
  var t = PitModelState._three;
  var g = _pit3dEnsureSectionPickGroup();
  if (!g) return;
  var loc = _pit3dWorldToLocal(x, y, _pit3dNearestZ(x, y));
  var mat = new THREE.MeshBasicMaterial({ color: color });
  var sph = new THREE.Mesh(new THREE.SphereGeometry(t.markerR * 1.3, 12, 12), mat);
  sph.position.set(loc.x, loc.y, loc.z);
  g.add(sph);
}

function _pit3dAddSectionLine(a, b) {
  var g = _pit3dEnsureSectionPickGroup();
  if (!g) return;
  var bb = PitModelState.robustBBox || PitModelState.bbox;
  var lift = bb ? (bb.zMax - bb.zMin) * 0.01 : 1; // чуть приподнимаем линию над рельефом, чтобы не проваливалась в меш
  var N = 24;
  var positions = new Float32Array((N+1) * 3);
  for (var i = 0; i <= N; i++) {
    var tt = i / N;
    var x = a.x + (b.x-a.x)*tt, y = a.y + (b.y-a.y)*tt;
    var loc = _pit3dWorldToLocal(x, y, _pit3dNearestZ(x, y) + lift);
    positions[i*3]=loc.x; positions[i*3+1]=loc.y; positions[i*3+2]=loc.z;
  }
  var geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  var mat = new THREE.LineBasicMaterial({ color: 0xf59e0b, linewidth: 2 });
  g.add(new THREE.Line(geo, mat));
}

function _pit3dExitSectionPicking() {
  PitModelState.sectionPicking = false;
  if (PitModelState._three) PitModelState._three.controls.enableRotate = true;
  var btn = document.getElementById('pit3d-section-btn');
  if (btn) { btn.textContent = '✂ Разрез'; btn.classList.remove('btn-primary'); }
}

function _pit3dStartSectionPicking() {
  if (!PitModelState._three) { _pit3dSetStatus('Модель ещё не отрендерена', true); return; }
  if (PitModelState.sectionPicking) { _pit3dExitSectionPicking(); _pit3dSetStatus(''); return; } // повторный клик — отмена
  PitModelState.sectionPicking = true;
  PitModelState.sectionA = null;
  PitModelState.sectionB = null;
  _pit3dClearSectionPickMarkers();
  // На время выбора точек отключаем вращение камеры левой кнопкой — иначе обычный клик
  // мышью (с естественным дрожанием руки в пару пикселей) распознаётся как вращение,
  // а не как выбор точки, и клик "не срабатывает"
  PitModelState._three.controls.enableRotate = false;
  _pit3dSetStatus('Кликните две точки на модели, чтобы задать линию разреза (вращение камеры временно отключено)');
  var btn = document.getElementById('pit3d-section-btn');
  if (btn) { btn.textContent = '✂ Кликните на модель… (ещё раз — отмена)'; btn.classList.add('btn-primary'); }
}

function _pit3dHandleSectionClick(x, y) {
  if (!PitModelState.sectionA) {
    PitModelState.sectionA = { x:x, y:y };
    _pit3dAddSectionMarker(x, y, 0xf59e0b);
    _pit3dSetStatus('Точка A задана — кликните вторую точку (B)');
  } else if (!PitModelState.sectionB) {
    PitModelState.sectionB = { x:x, y:y };
    _pit3dAddSectionMarker(x, y, 0xef4444);
    _pit3dAddSectionLine(PitModelState.sectionA, PitModelState.sectionB);
    _pit3dExitSectionPicking();
    _pit3dSetStatus('');
    _pit3dShowSectionModal(null);
  }
}

/* ── Фаза 3: расчёт и отображение профиля разреза ─────────────────────────────── */
function _pit3dComputeSectionData(ax, ay, bx, by) {
  var terrain = _pit3dSectionProfile(PitModelState.xs, PitModelState.ys, PitModelState.zs, PitModelState.triangles, ax, ay, bx, by);
  var water = null;
  if (PitModelState._contourData && PitModelState._contourData.tin) {
    var tin = PitModelState._contourData.tin;
    water = _pit3dSectionProfile(tin.xs, tin.ys, tin.zs, tin.triangles, ax, ay, bx, by);
  }
  return { terrain: terrain, water: water };
}

function _pit3dShowSectionModal(sectionRec) {
  var A = sectionRec ? { x: sectionRec.ax, y: sectionRec.ay } : PitModelState.sectionA;
  var B = sectionRec ? { x: sectionRec.bx, y: sectionRec.by } : PitModelState.sectionB;
  if (!A || !B) return;

  var data = _pit3dComputeSectionData(A.x, A.y, B.x, B.y);
  if (!data.terrain.points.length) {
    _pit3dSetStatus('Линия разреза не пересекает модель рельефа', true);
    return;
  }

  var existing = document.getElementById('pit3d-section-modal');
  if (existing) existing.remove();

  var overlay = document.createElement('div');
  overlay.id = 'pit3d-section-modal';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.75);z-index:999;display:flex;align-items:center;justify-content:center;padding:24px';

  var modal = document.createElement('div');
  modal.style.cssText = 'width:min(900px,95%);height:min(560px,90%);display:flex;flex-direction:column;background:var(--bg-2);border-radius:10px;overflow:hidden;box-shadow:var(--shadow-card)';

  var defaultName = 'Разрез ' + new Date().toLocaleDateString('ru-RU');
  var hdr = document.createElement('div');
  hdr.style.cssText = 'display:flex;justify-content:space-between;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid var(--line);flex-wrap:wrap';
  hdr.innerHTML =
    '<div style="display:flex;align-items:center;gap:8px;flex:1;min-width:260px">' +
      '<input id="pit3d-sec-name" type="text" placeholder="Название разреза" value="' + escAttr(sectionRec ? sectionRec.name : defaultName) + '" ' +
        'style="background:var(--bg-1);color:var(--txt-1);border:1px solid var(--line);border-radius:5px;padding:5px 9px;font-size:13px;flex:1;min-width:160px">' +
      '<button class="btn btn-sm btn-primary" onclick="_pit3dSaveCurrentSection(' + (sectionRec ? "'" + sectionRec.id + "'" : 'null') + ')">💾 Сохранить</button>' +
      (sectionRec ? '<button class="btn btn-sm btn-outline" onclick="_pit3dDeleteSection(\'' + sectionRec.id + '\')">🗑 Удалить</button>' : '') +
    '</div>' +
    '<button id="pit3d-sec-close" style="background:none;border:none;color:var(--txt-2);font-size:18px;cursor:pointer;padding:2px 8px">✕</button>';
  modal.appendChild(hdr);

  var zsT = data.terrain.points.map(function(p){ return p.z; });
  var info = document.createElement('div');
  info.style.cssText = 'padding:8px 16px;font-size:12px;color:var(--txt-2);border-bottom:1px solid var(--line);display:flex;gap:18px;flex-wrap:wrap';
  info.innerHTML =
    '<span>Длина: <b style="color:var(--txt-1)">' + data.terrain.length.toFixed(0) + ' м</b></span>' +
    '<span>Рельеф: <b style="color:var(--txt-1)">' + Math.min.apply(null,zsT).toFixed(1) + ' – ' + Math.max.apply(null,zsT).toFixed(1) + ' м</b></span>' +
    (data.water && data.water.points.length
      ? '<span style="color:#60a5fa">● уровень подземных вод показан на графике</span>'
      : '<span style="color:var(--txt-3)">Изогипсы не построены — показан только рельеф</span>');
  modal.appendChild(info);

  var body = document.createElement('div');
  body.style.cssText = 'flex:1;position:relative;padding:14px;min-height:0';
  var canvas = document.createElement('canvas');
  body.appendChild(canvas);
  modal.appendChild(body);

  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  function close() {
    if (PitModelState._sectionChart) { PitModelState._sectionChart.destroy(); PitModelState._sectionChart = null; }
    overlay.remove();
  }
  document.getElementById('pit3d-sec-close').onclick = close;
  overlay.addEventListener('click', function(e) { if (e.target === overlay) close(); });

  var datasets = [{
    label: 'Рельеф',
    data: data.terrain.points.map(function(p) { return { x: p.s, y: p.z }; }),
    borderColor: '#c99a5b', backgroundColor: 'rgba(201,154,91,0.18)', fill: true,
    borderWidth: 2, pointRadius: 0, tension: 0,
  }];
  if (data.water && data.water.points.length) {
    datasets.push({
      label: 'Уровень подземных вод',
      data: data.water.points.map(function(p) { return { x: p.s, y: p.z }; }),
      borderColor: '#3b82f6', borderDash: [6,4],
      borderWidth: 2, pointRadius: 0, tension: 0, fill: false,
    });
  }

  PitModelState._sectionChart = new Chart(canvas, {
    type: 'line',
    data: { datasets: datasets },
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      scales: {
        x: { type: 'linear', title: { display: true, text: 'Расстояние вдоль разреза, м' } },
        y: { title: { display: true, text: 'Отметка, м' } },
      },
      plugins: { legend: { display: true } },
    },
  });
}

/* ── Фаза 3: сохранение/удаление/список разрезов ──────────────────────────────── */
async function _pit3dSaveCurrentSection(existingId) {
  var A = PitModelState.sectionA, B = PitModelState.sectionB;
  if ((!A || !B) && existingId) {
    var cur = PitModelState.savedSections.find(function(s) { return s.id === existingId; });
    if (cur) { A = { x: cur.ax, y: cur.ay }; B = { x: cur.bx, y: cur.by }; }
  }
  if (!A || !B) return;

  var nameEl = document.getElementById('pit3d-sec-name');
  var name = (nameEl && nameEl.value.trim()) || ('Разрез ' + new Date().toLocaleDateString('ru-RU'));
  var id = existingId || ('sec_' + Date.now() + '_' + Math.random().toString(36).slice(2,7));
  var rec = { id: id, name: name, ax: A.x, ay: A.y, bx: B.x, by: B.y, createdAt: new Date().toISOString() };

  await _pit3dSectionsSave(rec);
  var idx = PitModelState.savedSections.findIndex(function(s) { return s.id === id; });
  if (idx === -1) PitModelState.savedSections.push(rec); else PitModelState.savedSections[idx] = rec;

  if (typeof Toast !== 'undefined') Toast.show('Разрез сохранён', 'success');
  _pit3dRefreshSectionsButton();
}

async function _pit3dDeleteSection(id) {
  if (!confirm('Удалить этот разрез?')) return;
  await _pit3dSectionsDelete(id);
  PitModelState.savedSections = PitModelState.savedSections.filter(function(s) { return s.id !== id; });
  var modal = document.getElementById('pit3d-section-modal'); if (modal) modal.remove();
  if (PitModelState._sectionChart) { PitModelState._sectionChart.destroy(); PitModelState._sectionChart = null; }
  _pit3dRefreshSectionsButton();
}

function _pit3dRefreshSectionsButton() {
  var btn = document.getElementById('pit3d-sections-list-btn');
  if (btn) btn.textContent = '📋 Разрезы (' + PitModelState.savedSections.length + ')';
}

function _pit3dSectionsPopOutsideClick(e) {
  var pop = document.getElementById('pit3d-sections-pop');
  if (!pop) return;
  if (e.composedPath().indexOf(pop) === -1) { pop.remove(); document.removeEventListener('click', _pit3dSectionsPopOutsideClick); }
}

function _pit3dOpenSectionsList(anchorEl) {
  var existing = document.getElementById('pit3d-sections-pop');
  if (existing) { existing.remove(); document.removeEventListener('click', _pit3dSectionsPopOutsideClick); return; }

  var pop = document.createElement('div');
  pop.id = 'pit3d-sections-pop';
  pop.style.cssText = 'position:fixed;z-index:50;background:var(--bg-2);border:1px solid var(--line);border-radius:8px;' +
    'box-shadow:var(--shadow-card);padding:10px;width:240px;max-height:min(60vh,400px);overflow:auto;font-size:12px;color:var(--txt-2)';

  var html = '<div style="font-weight:700;color:var(--txt-1);margin-bottom:8px">Сохранённые разрезы</div>';
  if (!PitModelState.savedSections.length) {
    html += '<div style="font-size:11px;color:var(--txt-3)">Пока нет сохранённых разрезов.</div>';
  } else {
    PitModelState.savedSections.slice().sort(function(a,b) { return b.createdAt.localeCompare(a.createdAt); }).forEach(function(s) {
      html += '<div style="display:flex;align-items:center;gap:6px;padding:5px 0;border-bottom:1px solid var(--line)">' +
        '<span style="flex:1;cursor:pointer;color:var(--txt-1);overflow:hidden;text-overflow:ellipsis;white-space:nowrap" onclick="_pit3dOpenSavedSection(\'' + s.id + '\')">' + escHTML(s.name) + '</span>' +
        '<button style="background:none;border:none;color:var(--txt-3);cursor:pointer;font-size:13px" onclick="event.stopPropagation();_pit3dDeleteSectionFromList(\'' + s.id + '\')" title="Удалить">🗑</button>' +
      '</div>';
    });
  }
  pop.innerHTML = html;
  document.body.appendChild(pop);

  var r = anchorEl.getBoundingClientRect();
  var top = r.bottom + 6, left = r.left;
  if (left + 240 > window.innerWidth) left = window.innerWidth - 250;
  pop.style.left = left + 'px';
  pop.style.top  = top + 'px';

  setTimeout(function() { document.addEventListener('click', _pit3dSectionsPopOutsideClick); }, 0);
}

function _pit3dOpenSavedSection(id) {
  var pop = document.getElementById('pit3d-sections-pop'); if (pop) pop.remove();
  document.removeEventListener('click', _pit3dSectionsPopOutsideClick);
  var rec = PitModelState.savedSections.find(function(s) { return s.id === id; });
  if (!rec) return;
  _pit3dShowSectionModal(rec);
}

async function _pit3dDeleteSectionFromList(id) {
  await _pit3dDeleteSection(id);
  var pop = document.getElementById('pit3d-sections-pop'); if (pop) pop.remove();
  document.removeEventListener('click', _pit3dSectionsPopOutsideClick);
}
