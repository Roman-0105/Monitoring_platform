/* ui-report.js — модуль отчётности карьера ЮРГ */
'use strict';

// ── Состояние ─────────────────────────────────────────────
var ReportState = {
  allPoints:  [],
  allDitches: [],
  allDates:   [],
  ptsA: [], ptsB: [],
  dtsA: [], dtsB: [],
  history:    {},
  photoCache: {},
  mapImgs:    { imgA: null, imgB: null },
  imgs3d:     {},
  aiText:     {},
  generating: false,
  settings: {
    author: '', position: 'Гидрогеолог', dateReport: '',
    reportMode: 'compare',
    dateA: '', dateB: '', weekA: '', weekB: '',
    reportVersion: 1,
    includeDomens: true, includeDitches: true, includePhotos: true,
    includeMap: true, include3d: false, includeHistory: true,
    includeCompare: true, includeAI: true,
    conclusions: '', apiKey: ''
  }
};

// ── Утилиты ───────────────────────────────────────────────
function escHtml(s) {
  return String(s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function fmtDate(d) {
  if (!d) return '—';
  var p = String(d).split('-');
  return p.length === 3 ? p[2]+'.'+p[1]+'.'+p[0] : d;
}
function getRField(id) {
  var el = document.getElementById(id);
  return el ? el.value.trim() : '';
}
function setRField(id, val) {
  var el = document.getElementById(id);
  if (el) el.value = val || '';
}
function lpsToM3h(v) { return (v || 0) * 3.6; }

function dateToWeekKey(dateStr) {
  if (!dateStr) return null;
  var d = new Date(dateStr);
  if (isNaN(d)) return null;
  var thu = new Date(d);
  thu.setDate(d.getDate() + (4 - (d.getDay() || 7)));
  var year = thu.getFullYear();
  var jan4 = new Date(year, 0, 4);
  var dow  = jan4.getDay() || 7;
  var mon1 = new Date(jan4);
  mon1.setDate(jan4.getDate() - (dow - 1));
  var week = Math.round((thu - mon1) / 604800000) + 1;
  return year + '-W' + String(week).padStart(2, '0');
}
function getWeekNumber(dateStr) {
  var wk = dateToWeekKey(dateStr);
  if (!wk) return '';
  var p = wk.split('-W');
  return p.length === 2 ? 'нед. ' + p[1] : '';
}
function fillDateDropdown(id, dates, selected) {
  var sel = document.getElementById(id);
  if (!sel) return;
  sel.innerHTML = dates.map(function(d) {
    return '<option value="' + d + '"' + (d === selected ? ' selected' : '') + '>' + fmtDate(d) + '</option>';
  }).join('');
}
function onReportDateChange() {
  var a = getRField('rp-date-a'), b = getRField('rp-date-b');
  var el = document.getElementById('rp-dates-status');
  if (!el) return;
  if (a && b && a !== b) {
    var diff = Math.round((new Date(b) - new Date(a)) / 86400000);
    el.textContent = diff > 0 ? 'Интервал: ' + diff + ' дн. (' + Math.round(diff/7) + ' нед.)' : '⚠ Дата Б раньше даты А';
    el.style.color = diff > 0 ? 'var(--txt-3)' : 'var(--red)';
  } else {
    el.textContent = '';
  }
}

// ── Инициализация ─────────────────────────────────────────
function initReportTab() {
  var root = document.getElementById('report-root');
  if (!root) return;
  root.innerHTML = buildSettingsUI();
  bindEvents();
  restoreSettings();
}

function restoreSettings() {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('report-settings') || '{}'); } catch(e) {}
  if (s.author)   setRField('rp-author',   s.author);
  if (s.position) setRField('rp-position', s.position);
  if (s.apiKey)   setRField('rp-apikey',   s.apiKey);
  setRField('rp-date', new Date().toISOString().slice(0, 10));
}

function saveReportSettings() {
  try {
    localStorage.setItem('report-settings', JSON.stringify({
      author:   getRField('rp-author'),
      position: getRField('rp-position'),
      apiKey:   getRField('rp-apikey'),
      reportVersion: ReportState.settings.reportVersion
    }));
  } catch(e) {}
}

function bindEvents() {
  ['rp-author','rp-position','rp-apikey'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', saveReportSettings);
  });
}

// ── UI настроек ───────────────────────────────────────────
function rpCheck(id, label, checked) {
  return '<label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px">' +
    '<input type="checkbox" id="' + id + '"' + (checked ? ' checked' : '') + ' style="width:14px;height:14px">' +
    '<span>' + label + '</span></label>';
}

function buildSettingsUI() {
  return '<div style="max-width:860px;margin:0 auto;padding:16px 0">' +

  '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">' +
    '<div><h2 style="margin:0;font-size:18px;font-weight:500">Формирование отчёта</h2>' +
    '<div style="font-size:12px;color:var(--txt-3);margin-top:3px">Мониторинг подземных вод карьера ЮРГ</div></div>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-outline" id="rp-load-btn" onclick="loadReportData()">📥 Загрузить данные</button>' +
      '<button class="btn btn-primary" id="rp-generate-btn" onclick="generateReport()" style="opacity:0.5;pointer-events:none">📄 Сформировать отчёт</button>' +
    '</div>' +
  '</div>' +

  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +

  '<div class="card" style="padding:16px">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:12px">Составитель</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div><label style="font-size:12px;color:var(--txt-2);display:block;margin-bottom:4px">ФИО</label>' +
        '<input class="form-input" id="rp-author" placeholder="Юкин Р.А." style="font-size:13px"></div>' +
      '<div><label style="font-size:12px;color:var(--txt-2);display:block;margin-bottom:4px">Должность</label>' +
        '<input class="form-input" id="rp-position" placeholder="Гидрогеолог" style="font-size:13px"></div>' +
      '<div><label style="font-size:12px;color:var(--txt-2);display:block;margin-bottom:4px">Дата составления</label>' +
        '<input class="form-input" type="date" id="rp-date" style="font-size:13px"></div>' +
    '</div>' +
  '</div>' +

  '<div class="card" style="padding:16px">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Период отчёта</div>' +
    '<div style="display:flex;gap:6px;margin-bottom:12px">' +
      '<button class="btn btn-sm" id="rp-mode-single" onclick="setReportMode(\'single\')" style="flex:1;font-size:12px">📅 Одна неделя</button>' +
      '<button class="btn btn-sm btn-primary" id="rp-mode-compare" onclick="setReportMode(\'compare\')" style="flex:1;font-size:12px">📊 Сравнение недель</button>' +
    '</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      '<div><label id="rp-label-a" style="font-size:12px;color:var(--txt-2);display:block;margin-bottom:4px">Неделя А (базовая)</label>' +
        '<select class="form-input" id="rp-date-a" style="font-size:13px" onchange="onReportDateChange()">' +
          '<option value="">— загрузите данные —</option></select></div>' +
      '<div id="rp-period-b-block">' +
        '<label style="font-size:12px;color:var(--txt-2);display:block;margin-bottom:4px">Неделя Б (текущая)</label>' +
        '<select class="form-input" id="rp-date-b" style="font-size:13px" onchange="onReportDateChange()">' +
          '<option value="">— загрузите данные —</option></select></div>' +
      '<div id="rp-dates-status" style="font-size:11px;color:var(--txt-3);min-height:16px"></div>' +
    '</div>' +
  '</div>' +

  '</div>' +

  '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +

  '<div class="card" style="padding:16px">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:12px">Содержимое отчёта</div>' +
    '<div style="display:flex;flex-direction:column;gap:8px">' +
      rpCheck('rp-inc-domens',   'По доменам (Domen-1…5)', true) +
      rpCheck('rp-inc-ditches',  'Детали канав (профиль)', true) +
      rpCheck('rp-inc-photos',   'Фотофиксация (если есть)', true) +
      rpCheck('rp-inc-map',      'Схема карьера с точками', true) +
      rpCheck('rp-inc-history',  'История замеров', true) +
      rpCheck('rp-inc-compare',  'Сравнительный анализ А vs Б', true) +
    '</div>' +
  '</div>' +

  '<div class="card" style="padding:16px;border-color:rgba(127,119,221,.3)">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:#534AB7;margin-bottom:12px">Claude AI — автовыводы</div>' +
    '<div style="display:flex;flex-direction:column;gap:10px">' +
      rpCheck('rp-inc-ai', 'Авто-анализ по доменам и сравнению', true) +
      '<div><label style="font-size:12px;color:var(--txt-2);display:block;margin-bottom:4px">Anthropic API ключ</label>' +
        '<input class="form-input" id="rp-apikey" type="password" placeholder="sk-ant-..." style="font-size:12px;font-family:monospace">' +
        '<div style="font-size:11px;color:var(--txt-3);margin-top:4px">Ключ хранится только в браузере</div></div>' +
    '</div>' +
  '</div>' +

  '</div>' +

  '<div class="card" style="padding:16px;margin-bottom:16px">' +
    '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">Заключение и рекомендации</div>' +
    '<div style="display:flex;gap:8px;margin-bottom:8px">' +
      '<button class="btn btn-sm btn-outline" onclick="generateAIConclusion()" id="rp-ai-concl-btn">✨ Сгенерировать через AI</button>' +
      '<span style="font-size:12px;color:var(--txt-3);align-self:center">или введите вручную ↓</span>' +
    '</div>' +
    '<textarea id="rp-conclusions" class="form-input" rows="5" placeholder="Введите заключение и рекомендации..." style="resize:vertical;font-size:13px;line-height:1.6"></textarea>' +
  '</div>' +

  '<div id="rp-data-status" class="card" style="padding:14px;background:var(--bg-2);display:none">' +
    '<div style="font-size:13px;font-weight:500;margin-bottom:8px">📊 Загруженные данные</div>' +
    '<div id="rp-data-summary" style="font-size:12px;color:var(--txt-2)"></div>' +
  '</div>' +

  '</div>';
}

function setReportMode(mode) {
  ReportState.settings.reportMode = mode;
  var btnS = document.getElementById('rp-mode-single');
  var btnC = document.getElementById('rp-mode-compare');
  var blockB = document.getElementById('rp-period-b-block');
  var labelA = document.getElementById('rp-label-a');
  var cmpCheck = document.getElementById('rp-inc-compare');
  if (mode === 'single') {
    if (btnS) { btnS.className = 'btn btn-sm btn-primary'; btnS.style.flex='1'; btnS.style.fontSize='12px'; }
    if (btnC) { btnC.className = 'btn btn-sm'; btnC.style.flex='1'; btnC.style.fontSize='12px'; }
    if (blockB) blockB.style.display = 'none';
    if (labelA) labelA.textContent = 'Дата мониторинга';
    if (cmpCheck) { cmpCheck.checked = false; cmpCheck.disabled = true; }
  } else {
    if (btnS) { btnS.className = 'btn btn-sm'; btnS.style.flex='1'; btnS.style.fontSize='12px'; }
    if (btnC) { btnC.className = 'btn btn-sm btn-primary'; btnC.style.flex='1'; btnC.style.fontSize='12px'; }
    if (blockB) blockB.style.display = '';
    if (labelA) labelA.textContent = 'Неделя А (базовая)';
    if (cmpCheck) { cmpCheck.checked = true; cmpCheck.disabled = false; }
  }
}

// ── Загрузка данных ───────────────────────────────────────
function loadReportData() {
  var btn = document.getElementById('rp-load-btn');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Загрузка...'; }

  Promise.all([
    Api.getPoints('').catch(function() { return []; }),
    Api.getDitches('').catch(function() { return { ditches: [] }; })
  ]).then(function(results) {
    var rawPts = results[0];
    ReportState.allPoints  = Array.isArray(rawPts) ? rawPts : (rawPts && rawPts.points ? rawPts.points : []);
    ReportState.allDitches = (results[1] && results[1].ditches) ? results[1].ditches : [];

    var seen = {}, allDates = [];
    ReportState.allPoints.concat(ReportState.allDitches).forEach(function(r) {
      var d = (r.monitoringDate || '').slice(0, 10);
      if (d && !seen[d]) { seen[d] = 1; allDates.push(d); }
    });
    allDates.sort();
    ReportState.allDates = allDates;

    fillDateDropdown('rp-date-a', allDates, allDates.length >= 2 ? allDates[allDates.length-2] : allDates[0]);
    fillDateDropdown('rp-date-b', allDates, allDates[allDates.length-1]);
    onReportDateChange();

    var domens = [], ds = {};
    ReportState.allPoints.forEach(function(p) {
      var d = p.domain || p.domen || '—';
      if (!ds[d]) { ds[d] = 1; domens.push(d); }
    });

    var statusEl  = document.getElementById('rp-data-status');
    var summaryEl = document.getElementById('rp-data-summary');
    if (statusEl)  statusEl.style.display = '';
    if (summaryEl) summaryEl.innerHTML =
      '<span style="color:var(--blue)">▸ Всего точек: <b>' + ReportState.allPoints.length + '</b></span>&nbsp;&nbsp;' +
      '<span style="color:var(--gold)">▸ Всего канав: <b>' + ReportState.allDitches.length + '</b></span>&nbsp;&nbsp;' +
      '<span style="color:var(--txt-2)">▸ Дат мониторинга: <b>' + allDates.length + '</b></span>&nbsp;&nbsp;' +
      '<span style="color:var(--txt-2)">▸ Домены: <b>' + domens.join(', ') + '</b></span>';

    var genBtn = document.getElementById('rp-generate-btn');
    if (genBtn) { genBtn.style.opacity = '1'; genBtn.style.pointerEvents = ''; }

    Toast.show('Данные загружены: ' + allDates.length + ' дат мониторинга', 'success');
    return loadDitchesHistory();
  }).catch(function(err) {
    Toast.show('Ошибка загрузки: ' + err.message, 'error');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = '📥 Загрузить данные'; }
  });
}

function loadDitchesHistory() {
  ReportState.history    = {};  // история канав
  ReportState.ptHistory  = {};  // история точек

  var ditchTasks = ReportState.allDitches.map(function(d) {
    return Api.getDitchHistory(d.ditchName).then(function(r) {
      ReportState.history[d.ditchName] = (r && r.history) ? r.history : [];
    }).catch(function() { ReportState.history[d.ditchName] = []; });
  });

  // Уникальные номера точек
  var ptNums = [];
  var seen = {};
  ReportState.allPoints.forEach(function(p) {
    var n = String(p.pointNumber || '');
    if (n && !seen[n]) { seen[n] = 1; ptNums.push(n); }
  });

  var ptTasks = ptNums.map(function(num) {
    return Api.getHistory(num).then(function(hist) {
      ReportState.ptHistory[num] = Array.isArray(hist) ? hist : [];
    }).catch(function() { ReportState.ptHistory[num] = []; });
  });

  return Promise.all(ditchTasks.concat(ptTasks));
}

// ── Генерация AI заключения ───────────────────────────────
function generateAIConclusion() {
  var apiKey = getRField('rp-apikey');
  if (!apiKey) { Toast.show('Введите Anthropic API ключ', 'error'); return; }
  var btn = document.getElementById('rp-ai-concl-btn');
  if (btn) { btn.disabled = true; btn.textContent = '✨ Генерирую...'; }

  var s = ReportState.settings;
  var ptsA = ReportState.ptsA || [], ptsB = ReportState.ptsB || [];
  var qA = ptsA.reduce(function(s,p){ return s+(parseFloat(p.flowRate)||0); },0);
  var qB = ptsB.reduce(function(s,p){ return s+(parseFloat(p.flowRate)||0); },0);

  var prompt = 'Ты гидрогеолог. Составь профессиональное заключение (3-5 абзацев) по мониторингу подземных вод карьера ЮРГ.\n' +
    'Период А (' + (s.dateA||'—') + '): точек=' + ptsA.length + ', Q=' + qA.toFixed(1) + ' л/с\n' +
    'Период Б (' + (s.dateB||'—') + '): точек=' + ptsB.length + ', Q=' + qB.toFixed(1) + ' л/с\n' +
    'Канав: ' + ReportState.allDitches.length + '\n' +
    'Включи: общий вывод по гидрогеологической обстановке, оценку изменений, рекомендации.';

  callClaudeAPI(apiKey, prompt).then(function(text) {
    var ta = document.getElementById('rp-conclusions');
    if (ta) ta.value = text;
    Toast.show('Заключение сгенерировано', 'success');
  }).catch(function(err) {
    Toast.show('Ошибка AI: ' + err.message, 'error');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Сгенерировать через AI'; }
  });
}

function callClaudeAPI(apiKey, prompt) {
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (!data.content) throw new Error('Пустой ответ API: ' + JSON.stringify(data));
    return (data.content && data.content[0]) ? data.content[0].text : '';
  });
}

function generateAIBlocks(s) {
  if (!s.apiKey) return Promise.resolve({});
  var ptsA = ReportState.ptsA || [], ptsB = ReportState.ptsB || [];
  var qA = ptsA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
  var qB = ptsB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);

  var changes = ptsB.map(function(pb) {
    var pa = ptsA.find(function(p){ return p.pointNumber === pb.pointNumber; });
    var qa = pa ? parseFloat(pa.flowRate)||0 : null;
    var qb = parseFloat(pb.flowRate)||0;
    return pb.pointNumber + ': ' + (qa!==null?qa.toFixed(2)+'→':'') + qb.toFixed(2) + ' л/с' + (qa!==null?' (Δ'+(qb-qa>=0?'+':'')+(qb-qa).toFixed(2)+')':'');
  }).join('; ');

  var prompt = 'Ты гидрогеолог. Дай краткий анализ (2-3 предложения) изменений мониторинга карьера ЮРГ.\n' +
    'Период А (' + s.dateA + '): Q=' + qA.toFixed(1) + ' л/с. Период Б (' + s.dateB + '): Q=' + qB.toFixed(1) + ' л/с.\n' +
    'Точки: ' + (changes || 'нет данных') + '\n' +
    'Ответ ТОЛЬКО JSON без markdown: {"summary":"...","compare":"...","recommendations":"..."}';

  return callClaudeAPI(s.apiKey, prompt).then(function(text) {
    try { return JSON.parse(text.replace(/```json|```/g,'').trim()); }
    catch(e) { return { summary: text, compare: '', recommendations: '' }; }
  }).catch(function() { return {}; });
}

// ── Захват карты ──────────────────────────────────────────
function captureMapCanvas() {
  try {
    var canvas = document.getElementById('map-canvas');
    if (!canvas) return null;
    var px = canvas.getContext('2d').getImageData(0, 0, 4, 4).data;
    for (var i = 0; i < px.length; i++) { if (px[i] > 0) return canvas.toDataURL('image/jpeg', 0.85); }
    return null;
  } catch(e) { return null; }
}

function captureMapForWeek(weekKey) {
  return new Promise(function(resolve) {
    if (typeof switchTab !== 'function') { resolve(null); return; }
    switchTab('map');
    if (typeof _mapSelectedWeekKey !== 'undefined') {
      _mapSelectedWeekKey = weekKey || 'auto';
      _mapSchemeImg = null;
      var sel = document.getElementById('map-scheme-select');
      if (sel) sel.value = _mapSelectedWeekKey;
      if (typeof renderMap === 'function') renderMap();
    }
    var attempts = 0;
    function tryCapture() {
      attempts++;
      var img = captureMapCanvas();
      if (img) { resolve(img); return; }
      if (attempts >= 15) { resolve(null); return; }
      setTimeout(tryCapture, 400);
    }
    setTimeout(tryCapture, 600);
  });
}

function captureMapByWeekKeys(wkA, wkB, mode) {
  if (mode === 'single') {
    return captureMapForWeek(wkB).then(function(imgB) {
      restoreReportTab();
      return { imgA: null, imgB: imgB };
    });
  }
  var imgA = null;
  return captureMapForWeek(wkA).then(function(img) {
    imgA = img;
    return captureMapForWeek(wkB);
  }).then(function(imgB) {
    restoreReportTab();
    return { imgA: imgA, imgB: imgB };
  });
}

function restoreReportTab() {
  document.querySelectorAll('.page').forEach(function(p) {
    p.classList.toggle('active', p.id === 'page-report');
  });
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset && b.dataset.tab === 'report');
  });
  if (typeof AppState !== 'undefined') AppState.currentTab = 'report';
}

// ── Фото через Apps Script ────────────────────────────────
function extractDriveFileId(url) {
  if (!url) return null;
  var m = url.match(/[?&]id=([^&\s]+)/);
  if (m) return m[1];
  m = url.match(/\/d\/([^/?&]+)/);
  return m ? m[1] : null;
}

function fetchPhotoAsBase64(url) {
  var fileId = extractDriveFileId(url);
  if (!fileId) return Promise.resolve(null);
  return Api.getImage(fileId).then(function(data) {
    if (data && data.ok && data.base64 && data.mimeType) {
      return 'data:' + data.mimeType + ';base64,' + data.base64;
    }
    return null;
  }).catch(function() { return null; });
}

function preloadAllPhotos(ptsA, ptsB, dtsA, dtsB) {
  ReportState.photoCache = {};
  var tasks = [];

  // Загружаем фото с суффиксом периода — 'a' для недели А, 'b' для недели Б
  function loadPeriodPhotos(points, suffix) {
    (points || []).forEach(function(p) {
      var urls = Array.isArray(p.photoUrls) ? p.photoUrls : (p.photoUrl ? [p.photoUrl] : []);
      urls.forEach(function(url, i) {
        if (!url) return;
        var key = 'pt_' + p.pointNumber + '_' + i + '_' + suffix;
        tasks.push(fetchPhotoAsBase64(url).then(function(b64) {
          if (b64) ReportState.photoCache[key] = b64;
        }));
      });
    });
  }

  loadPeriodPhotos(ptsA, 'a');
  loadPeriodPhotos(ptsB, 'b');

  // Канавы аналогично
  function loadDitchPhotos(ditches, suffix) {
    (ditches || []).forEach(function(d) {
      var urls = Array.isArray(d.photoUrls) ? d.photoUrls : [];
      urls.forEach(function(url, i) {
        if (!url) return;
        var key = 'dt_' + (d.id || d.ditchName) + '_' + i + '_' + suffix;
        tasks.push(fetchPhotoAsBase64(url).then(function(b64) {
          if (b64) ReportState.photoCache[key] = b64;
        }));
      });
    });
  }

  loadDitchPhotos(dtsA, 'a');
  loadDitchPhotos(dtsB, 'b');

  return Promise.all(tasks);
}

// ── Генерация отчёта ──────────────────────────────────────
function generateReport() {
  if (ReportState.generating) return;
  if (!ReportState.allPoints.length && !ReportState.allDitches.length) {
    Toast.show('Сначала загрузите данные', 'error'); return;
  }
  ReportState.generating = true;
  var btn = document.getElementById('rp-generate-btn');
  if (btn) { btn.textContent = '⏳ Формирую...'; btn.disabled = true; }

  var s = ReportState.settings;
  s.author      = getRField('rp-author');
  s.position    = getRField('rp-position');
  s.dateReport  = getRField('rp-date');
  s.reportMode  = ReportState.settings.reportMode || 'compare';
  s.dateA       = getRField('rp-date-a');
  s.dateB       = s.reportMode === 'single' ? s.dateA : getRField('rp-date-b');
  s.weekA       = getWeekNumber(s.dateA);
  s.weekB       = s.reportMode === 'single' ? s.weekA : getWeekNumber(s.dateB);
  s.conclusions = getRField('rp-conclusions');
  s.apiKey      = getRField('rp-apikey');
  s.includeDomens  = !!(document.getElementById('rp-inc-domens')  || {checked:true}).checked;
  s.includeDitches = !!(document.getElementById('rp-inc-ditches') || {checked:true}).checked;
  s.includePhotos  = !!(document.getElementById('rp-inc-photos')  || {checked:true}).checked;
  s.includeMap     = !!(document.getElementById('rp-inc-map')     || {checked:true}).checked;
  s.includeHistory = !!(document.getElementById('rp-inc-history') || {checked:true}).checked;
  s.includeCompare = !!(document.getElementById('rp-inc-compare') || {checked:true}).checked;
  s.includeAI      = !!(document.getElementById('rp-inc-ai')      || {checked:true}).checked;
  s.reportVersion  = (parseInt(s.reportVersion) || 0) + 1;
  saveReportSettings();

  // Фильтруем данные по датам
  var allPts = ReportState.allPoints || [];
  var allDts = ReportState.allDitches || [];
  ReportState.ptsA = allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === s.dateA; });
  ReportState.ptsB = allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === s.dateB; });
  ReportState.dtsA = allDts.filter(function(d){ return (d.monitoringDate||'').slice(0,10) === s.dateA; });
  ReportState.dtsB = allDts.filter(function(d){ return (d.monitoringDate||'').slice(0,10) === s.dateB; });

  Toast.progress('rp-gen', 'Захват схем карьера...');

  var wkA = dateToWeekKey(s.dateA);
  var wkB = dateToWeekKey(s.dateB);
  var mapPromise = s.includeMap
    ? captureMapByWeekKeys(wkA, wkB, s.reportMode)
    : Promise.resolve({ imgA: null, imgB: null });

  mapPromise.then(function(mapImgs) {
    ReportState.mapImgs = mapImgs || { imgA: null, imgB: null };
    if (s.includePhotos) {
      Toast.progress('rp-gen', 'Загрузка фотографий...');
      return preloadAllPhotos(ReportState.ptsA, ReportState.ptsB, ReportState.dtsA, ReportState.dtsB);
    }
    return Promise.resolve();

  }).then(function() {
    if (s.includeAI && s.apiKey) {
      Toast.progress('rp-gen', 'Генерация AI анализа...');
      return generateAIBlocks(s);
    }
    return Promise.resolve({});

  }).then(function(aiBlocks) {
    ReportState.aiText = aiBlocks || {};
    Toast.progress('rp-gen', 'Сборка отчёта...');
    restoreReportTab();

    var html = buildReportHTML(s);
    Toast.done('rp-gen', 'Отчёт сформирован — открываю...');

    var win = window.open('', '_blank');
    if (win) { win.document.write(html); win.document.close(); }
    else {
      var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'report-yrg-v' + s.reportVersion + '.html';
      a.click();
    }
  }).catch(function(err) {
    Toast.fail('rp-gen', 'Ошибка: ' + (err && err.message ? err.message : String(err)));
    restoreReportTab();
  }).finally(function() {
    ReportState.generating = false;
    if (btn) { btn.textContent = '📄 Сформировать отчёт'; btn.disabled = false; }
  });
}

// ── Построители HTML блоков ───────────────────────────────
function h(tag, attrs, inner) {
  var a = Object.keys(attrs || {}).map(function(k){ return ' ' + k + '="' + attrs[k] + '"'; }).join('');
  return '<' + tag + a + '>' + (inner || '') + '</' + tag + '>';
}

// Donut SVG диаграмма
function buildDonutSVG(counts, keys, colors, total) {
  if (!total) return '<div style="text-align:center;color:#888;font-size:11px;padding:20px">нет данных</div>';
  var cx = 70, cy = 70, r = 52, circ = 2 * Math.PI * r, offset = 0;
  var arcs = '';
  keys.filter(function(k){ return counts[k] > 0; }).forEach(function(k) {
    var len = counts[k] / total * circ;
    arcs += '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '"' +
      ' fill="none" stroke="' + (colors[k] || '#888') + '" stroke-width="18" stroke-linecap="butt"' +
      ' stroke-dasharray="' + len.toFixed(2) + ' ' + circ.toFixed(2) + '"' +
      ' stroke-dashoffset="' + (-offset).toFixed(2) + '"' +
      ' transform="rotate(-90 ' + cx + ' ' + cy + ')"></circle>';
    offset += len;
  });
  var legend = keys.filter(function(k){ return counts[k]>0; }).map(function(k) {
    return '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;font-size:11px">' +
      '<span style="display:flex;align-items:center;gap:5px">' +
        '<span style="width:10px;height:10px;border-radius:50%;background:' + (colors[k]||'#888') + ';display:inline-block;flex-shrink:0"></span>' +
        escHtml(k) + '</span><b>' + counts[k] + '</b></div>';
  }).join('');
  return '<div style="display:flex;align-items:center;gap:14px">' +
    '<svg viewBox="0 0 140 140" width="100" height="100" style="flex-shrink:0">' +
      '<circle cx="' + cx + '" cy="' + cy + '" r="' + r + '" fill="none" stroke="#e9ecef" stroke-width="18"></circle>' +
      arcs +
      '<text x="' + cx + '" y="' + (cy-5) + '" text-anchor="middle" font-size="18" font-weight="700" fill="#1a1a2e">' + total + '</text>' +
      '<text x="' + cx + '" y="' + (cy+10) + '" text-anchor="middle" font-size="9" fill="#888">точек</text>' +
    '</svg>' +
    '<div style="flex:1">' + legend + '</div></div>';
}

// Разбивка по горизонтам
function buildHorizonTable(pts, label, color) {
  if (!pts || !pts.length) return '';
  var byH = {};
  pts.forEach(function(p) {
    var h = (p.horizon && String(p.horizon).trim()) ? String(p.horizon).trim() : '—';
    if (!byH[h]) byH[h] = { count:0, total:0, withFlow:0 };
    byH[h].count++;
    var f = parseFloat(p.flowRate);
    if (!isNaN(f)) { byH[h].total += f; byH[h].withFlow++; }
  });
  var keys = Object.keys(byH).sort(function(a,b){ return byH[b].total - byH[a].total || byH[b].count - byH[a].count; });
  var maxLps = Math.max.apply(null, keys.map(function(k){ return byH[k].total; })) || 1;

  var rows = keys.map(function(k) {
    var d = byH[k];
    var isUnk = k === '—';
    var sumLps = d.withFlow ? d.total.toFixed(2) : '—';
    var sumM3h = d.withFlow ? (d.total * 3.6).toFixed(2) : '—';
    var avg    = (d.withFlow && d.withFlow > 0) ? (d.total / d.withFlow).toFixed(2) : '—';
    var bar    = maxLps > 0 ? (d.total / maxLps * 100).toFixed(0) : 0;
    return '<tr style="border-bottom:1px solid #f0f0f0">' +
      '<td style="padding:5px 8px;font-weight:' + (isUnk?'400':'600') + ';color:' + (isUnk?'#aaa':'#1a1a2e') + '">' +
        (isUnk ? '— не указан —' : '⛰ ' + escHtml(k)) + '</td>' +
      '<td style="padding:5px 8px;text-align:center">' + d.count + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#1a73e8;font-weight:600">' + sumLps + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#f9ab00">' + sumM3h + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#555">' + avg + '</td>' +
      '<td style="padding:5px 8px;width:70px">' +
        '<div style="height:5px;background:#e9ecef;border-radius:3px">' +
          '<div style="height:5px;border-radius:3px;background:' + (color||'#1a73e8') + ';width:' + bar + '%"></div>' +
        '</div></td>' +
    '</tr>';
  }).join('');

  var named = keys.filter(function(k){ return k !== '—'; });
  var footer = '';
  if (named.length > 1) {
    var gLps = named.reduce(function(s,k){ return s + byH[k].total; }, 0);
    var gCnt = named.reduce(function(s,k){ return s + byH[k].count; }, 0);
    footer = '<tr style="border-top:2px solid #dee2e6;background:#f8f9fa;font-weight:600">' +
      '<td style="padding:5px 8px">Итого по горизонтам</td>' +
      '<td style="padding:5px 8px;text-align:center">' + gCnt + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#1a73e8">' + gLps.toFixed(2) + '</td>' +
      '<td style="padding:5px 8px;text-align:right;color:#f9ab00">' + (gLps*3.6).toFixed(2) + '</td>' +
      '<td colspan="2"></td></tr>';
  }

  return '<div style="margin-top:10px">' +
    (label ? '<div style="font-size:11px;font-weight:600;color:' + (color||'#1a73e8') + ';margin-bottom:5px">' + escHtml(label) + '</div>' : '') +
    '<table class="rp-table" style="width:100%">' +
      '<thead><tr><th>Горизонт</th><th style="text-align:center">Точек</th>' +
        '<th style="text-align:right">Σ л/с</th><th style="text-align:right">Σ м³/ч</th>' +
        '<th style="text-align:right">Ср. л/с</th><th></th></tr></thead>' +
      '<tbody>' + rows + footer + '</tbody>' +
    '</table></div>';
}

// SVG-график истории замеров точки
function buildPointHistoryChart(pointNumber, markerA, markerB) {
  // markerA/markerB — даты недель А и Б для подсветки
  var hist = (ReportState.ptHistory || {})[String(pointNumber)] || [];
  if (!hist.length) return '';

  var sorted = hist.slice().sort(function(a,b) {
    return (a.monitoringDate||'') < (b.monitoringDate||'') ? -1 : 1;
  });
  var data = sorted.filter(function(h) {
    return h.flowRate != null && !isNaN(parseFloat(h.flowRate));
  }).map(function(h) {
    return { date: (h.monitoringDate||'').slice(0,10), q: parseFloat(h.flowRate)||0 };
  });

  if (data.length < 2) return '';

  var n = data.length;
  var W = 700, CHART_H = 100, DATE_H = 48;  // место под даты под углом
  var H = CHART_H + DATE_H;
  var PL = 38, PR = 16, PT = 20, PB = 4;
  var iW = W - PL - PR, iH = CHART_H - PT - PB;

  var minQ = Math.min.apply(null, data.map(function(d){ return d.q; }));
  var maxQ = Math.max.apply(null, data.map(function(d){ return d.q; }));
  if (maxQ === minQ) { minQ = Math.max(0, minQ - 0.1); maxQ = maxQ + 0.1; }
  var qRange = maxQ - minQ || 1;

  function sx(i) { return PL + i / (n - 1) * iW; }
  function sy(q)  { return PT + iH - (q - minQ) / qRange * iH; }

  var polyline = data.map(function(d,i){ return sx(i).toFixed(1)+','+sy(d.q).toFixed(1); }).join(' ');
  var area = polyline + ' ' + (PL+iW) + ',' + (PT+iH) + ' ' + PL + ',' + (PT+iH);

  // Ось Y — 4 деления
  var yAxis = '';
  var ySteps = 3;
  for (var yi = 0; yi <= ySteps; yi++) {
    var qv = minQ + (maxQ - minQ) * yi / ySteps;
    var yp = sy(qv).toFixed(1);
    yAxis += '<line x1="' + (PL-3) + '" y1="' + yp + '" x2="' + (PL+iW) + '" y2="' + yp +
      '" stroke="#f0f0f0" stroke-width="1"/>' +
      '<text x="' + (PL-5) + '" y="' + yp + '" text-anchor="end" font-size="9"' +
      ' dominant-baseline="middle" fill="#bbb">' + qv.toFixed(2) + '</text>';
  }

  // Точки + подписи Q сверху + даты снизу под углом
  var dots = '', qLabels = '', dateLabels = '', markers = '';

  data.forEach(function(d, i) {
    var cx = sx(i), cy = sy(d.q);
    var isMarkA = markerA && d.date === markerA;
    var isMarkB = markerB && d.date === markerB;
    var isLast  = i === n - 1;

    // Цвет точки
    var fillColor = isMarkB ? '#1a73e8' : (isMarkA ? '#888' : '#fff');
    var strokeColor = isMarkB ? '#1a73e8' : (isMarkA ? '#888' : '#1a73e8');
    var r = (isMarkA || isMarkB) ? 5 : 3.5;
    var strokeW = (isMarkA || isMarkB) ? 2 : 1.5;

    dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '"' +
      ' fill="' + fillColor + '" stroke="' + strokeColor + '" stroke-width="' + strokeW + '"/>';

    // Подпись Q над точкой
    var qColor = isMarkB ? '#1a73e8' : (isMarkA ? '#666' : '#555');
    var qFontSize = (isMarkA || isMarkB) ? 10 : 8.5;
    var qFontWeight = (isMarkA || isMarkB) ? '700' : '400';
    var qY = cy < PT + 14 ? cy + 14 : cy - 6; // если точка высоко — пишем под ней
    qLabels += '<text x="' + cx.toFixed(1) + '" y="' + qY.toFixed(1) + '"' +
      ' text-anchor="middle" font-size="' + qFontSize + '" font-weight="' + qFontWeight + '" fill="' + qColor + '">' +
      d.q.toFixed(2) + '</text>';

    // Дата под углом −45° от нижней линии графика
    // Формат: ДД.ММ.ГГГГ
    var dp = d.date.split('-');
    var dateStr = dp.length === 3 ? dp[2] + '.' + dp[1] + '.' + dp[0] : d.date;
    var dateColor = isMarkB ? '#1a73e8' : (isMarkA ? '#888' : '#aaa');
    var dateFontSize = (isMarkA || isMarkB) ? 9 : 8;
    var dateFontWeight = (isMarkA || isMarkB) ? '700' : '400';
    var dateY = CHART_H + 4; // стартовая Y у нижней линии
    dateLabels += '<text transform="rotate(-42,' + cx.toFixed(1) + ',' + dateY + ')"' +
      ' x="' + cx.toFixed(1) + '" y="' + dateY + '"' +
      ' text-anchor="end" font-size="' + dateFontSize + '" font-weight="' + dateFontWeight + '" fill="' + dateColor + '">' +
      dateStr + '</text>';

    // Вертикальная линия маркера недели
    if (isMarkA) {
      markers += '<line x1="' + cx.toFixed(1) + '" y1="' + PT + '" x2="' + cx.toFixed(1) + '" y2="' + (PT+iH) + '"' +
        ' stroke="#999" stroke-width="1" stroke-dasharray="3,2"/>';
    }
    if (isMarkB) {
      markers += '<line x1="' + cx.toFixed(1) + '" y1="' + PT + '" x2="' + cx.toFixed(1) + '" y2="' + (PT+iH) + '"' +
        ' stroke="#1a73e8" stroke-width="1" stroke-dasharray="3,2"/>';
    }
  });

  // Легенда маркеров
  var legend = '';
  if (markerA && markerB) {
    legend = '<div style="display:flex;gap:16px;font-size:10px;color:#888;margin-top:2px;padding-left:' + PL + 'px">' +
      '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#888;margin-right:4px"></span>Нед. А</span>' +
      '<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:#1a73e8;margin-right:4px"></span>Нед. Б</span>' +
    '</div>';
  }

  return '<div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '"' +
    ' style="width:100%;display:block;overflow:visible">' +
      '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT+iH) + '" stroke="#e8e8e8" stroke-width="1"/>' +
      '<line x1="' + PL + '" y1="' + (PT+iH) + '" x2="' + (PL+iW) + '" y2="' + (PT+iH) + '" stroke="#e8e8e8" stroke-width="1"/>' +
      yAxis +
      markers +
      '<polygon points="' + area + '" fill="#1a73e8" opacity=".07"/>' +
      '<polyline points="' + polyline + '" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round"/>' +
      dots + qLabels + dateLabels +
    '</svg>' +
    legend +
  '</div>';
}

// Компактная карточка точки: фото(А+Б) + график + комментарий
function buildPointCard(pb, pa, s) {
  var qb = parseFloat(pb.flowRate) || 0;
  var qa = pa != null ? parseFloat(pa.flowRate) || 0 : null;
  var delta = qa != null ? qb - qa : null;
  var isSingle = s.reportMode === 'single';
  var cache = ReportState.photoCache || {};

  var trendColor = delta == null ? '#888' : (delta > 0.001 ? '#d93025' : (delta < -0.001 ? '#188038' : '#888'));
  var trendArrow = delta == null ? '' : (delta > 0.001 ? '▲' : (delta < -0.001 ? '▼' : '→'));

  // Получаем фото из кэша по суффиксу периода
  function getPhotoSrc(pointNum, suffix) {
    return cache['pt_' + pointNum + '_0_' + suffix] || null;
  }

  function photoBlock(src, weekLabel, dateLabel, labelBg) {
    var imgHtml = src
      ? '<img src="' + src + '" style="width:100%;height:190px;object-fit:cover;display:block" alt="' + escHtml(weekLabel) + '">'
      : '<div style="height:190px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#f8f9fa">' +
          '<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;' +
            'background:' + (labelBg === '#888' ? '#e8e8e8' : '#e8f0fe') + ';color:' + labelBg + '">' +
            (labelBg === '#888' ? 'А' : 'Б') + '</div>' +
          '<span style="font-size:10px;color:#bbb">фото отсутствует</span>' +
        '</div>';
    return '<div style="flex:1;min-width:0">' +
      imgHtml +
      '<div style="display:flex;align-items:center;gap:6px;padding:5px 10px;border-top:1px solid #e0e6f0">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + labelBg + ';flex-shrink:0"></span>' +
        '<span style="font-size:10px;font-weight:600;color:#444">' + escHtml(weekLabel) + '</span>' +
        '<span style="font-size:10px;color:#888;margin-left:auto">' + escHtml(dateLabel) + '</span>' +
      '</div>' +
    '</div>';
  }

  // ── Шапка
  var header = '<div style="display:flex;align-items:center;gap:8px;background:#f7f9fc;padding:8px 14px;border-bottom:1px solid #e0e6f0">' +
    '<span style="font-size:15px;font-weight:700;color:#1a1a2e">#' + escHtml(String(pb.pointNumber)) + '</span>' +
    '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#e6f4ea;color:#188038;font-weight:600">' + escHtml(pb.status || '—') + '</span>' +
    '<span style="font-size:11px;color:#666">' + escHtml(pb.intensity || '') + (pb.waterColor ? ' · ' + escHtml(pb.waterColor) : '') + (pb.horizon ? ' · гор. ' + escHtml(String(pb.horizon)) : '') + '</span>' +
    '<div style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px">' +
      (qa != null ? '<span style="color:#888">нед. А: <b>' + qa.toFixed(2) + '</b></span><span style="color:#ccc">→</span>' : '') +
      '<span style="color:#1a73e8;font-weight:700">нед. Б: ' + qb.toFixed(2) + ' л/с</span>' +
      (delta != null ? '<span style="font-weight:700;color:' + trendColor + '">' + trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + '</span>' : '') +
    '</div>' +
  '</div>';

  // ── Фото (2 колонки для сравнения, 1 для одиночного)
  var photosRow = '';
  if (!isSingle && pa != null) {
    var srcA = getPhotoSrc(pb.pointNumber, 'a');
    var srcB = getPhotoSrc(pb.pointNumber, 'b');
    photosRow = '<div style="display:flex;gap:0;border-bottom:1px solid #e0e6f0">' +
      photoBlock(srcA, 'Неделя А', fmtDate(s.dateA) + ' · ' + escHtml(s.weekA), '#888') +
      '<div style="width:1px;background:#e0e6f0;flex-shrink:0"></div>' +
      photoBlock(srcB, 'Неделя Б', fmtDate(s.dateB) + ' · ' + escHtml(s.weekB), '#1a73e8') +
    '</div>';
  } else if (s.includePhotos) {
    var srcB2 = getPhotoSrc(pb.pointNumber, 'b') || getPhotoSrc(pb.pointNumber, 'a');
    if (srcB2) {
      photosRow = '<div style="border-bottom:1px solid #e0e6f0">' +
        '<img src="' + srcB2 + '" style="width:100%;max-height:200px;object-fit:cover;display:block">' +
        '<div style="padding:4px 10px;font-size:10px;color:#888;background:#f8f9fa">' + fmtDate(s.dateB) + ' · ' + escHtml(s.weekB) + '</div>' +
      '</div>';
    }
  }

  // ── График на всю ширину
  var chartRow = '';
  if (s.includeHistory) {
    var chartHtml = buildPointHistoryChart(pb.pointNumber, s.dateA, s.dateB);
    if (chartHtml) {
      chartRow = '<div style="padding:12px 16px;border-bottom:1px solid #e0e6f0">' +
        '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:8px">Динамика водопритока Q, л/с</div>' +
        chartHtml +
      '</div>';
    }
  }

  // ── Метрики (4 ячейки)
  var numHist = ((ReportState.ptHistory || {})[String(pb.pointNumber)] || []).length;
  var metricsRow = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e0e6f0">' +
    (qa != null
      ? '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Q нед. А</div>' +
          '<div style="font-size:14px;font-weight:700;color:#1a1a2e">' + qa.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span></div></div>'
      : '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Метод</div>' +
          '<div style="font-size:11px;color:#555">' + escHtml(pb.measureMethod || '—') + '</div></div>') +
    '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Q нед. Б</div>' +
      '<div style="font-size:14px;font-weight:700;color:#1a73e8">' + qb.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span></div></div>' +
    '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Изменение</div>' +
      '<div style="font-size:14px;font-weight:700;color:' + trendColor + '">' +
        (delta != null ? trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span>' : '—') +
      '</div></div>' +
    '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Замеров в истории</div>' +
      '<div style="font-size:14px;font-weight:700;color:#555">' + numHist + '</div></div>' +
  '</div>';

  // ── Комментарий
  var commentRow = pb.comment
    ? '<div style="padding:7px 14px;font-size:11px;color:#444;border-left:3px solid #f9ab00;background:#fffde7">' +
        '<b>Комментарий:</b> ' + escHtml(pb.comment) + '</div>'
    : '';

  return '<div style="border:1px solid #e0e6f0;border-radius:8px;overflow:hidden;margin-bottom:14px;page-break-inside:avoid;break-inside:avoid">' +
    header + photosRow + chartRow + metricsRow + commentRow +
  '</div>';
}

// Фото точек (старый метод — оставляем для совместимости)
function buildPhotosBlock(points) {
  var cache = ReportState.photoCache || {};
  var html = '';
  (points || []).forEach(function(p) {
    var b64 = cache['pt_' + p.pointNumber + '_0'];
    if (!b64) { var raw = (p.photoUrls && p.photoUrls[0]) || p.photoUrl || ''; if (raw) b64 = raw; }
    if (!b64) return;
    html += '<div class="rp-photo-row">' +
      '<div class="rp-photo-img-wrap"><img src="' + b64 + '" alt="Точка #' + escHtml(String(p.pointNumber)) + '" class="rp-photo-img">' +
        '<div class="rp-photo-label">Точка #' + escHtml(String(p.pointNumber)) + '</div></div>' +
      '<div class="rp-photo-info">' +
        '<div class="rp-photo-info-title">Точка #' + escHtml(String(p.pointNumber)) + '</div>' +
        '<table class="rp-photo-meta">' +
          (p.status    ? '<tr><td>Статус</td><td>'       + escHtml(p.status)    + '</td></tr>' : '') +
          (p.intensity ? '<tr><td>Интенсивность</td><td>'+ escHtml(p.intensity) + '</td></tr>' : '') +
          '<tr><td>Q</td><td>' + (parseFloat(p.flowRate)||0).toFixed(2) + ' л/с</td></tr>' +
          (p.waterColor ? '<tr><td>Цвет воды</td><td>'  + escHtml(p.waterColor) + '</td></tr>' : '') +
        '</table>' +
        (p.comment
          ? '<div class="rp-photo-comment"><b>Комментарий:</b> ' + escHtml(p.comment) + '</div>'
          : '<div class="rp-photo-comment rp-photo-comment--empty">Комментарий отсутствует</div>') +
      '</div></div>';
  });
  return html ? '<div class="rp-photos-block">' + html + '</div>' : '';
}

// Фото канавы
function buildDitchPhotos(d) {
  var cache = ReportState.photoCache || {};
  var urls  = Array.isArray(d.photoUrls) ? d.photoUrls.filter(Boolean) : [];
  var html  = '';
  urls.forEach(function(url, i) {
    var b64 = cache['dt_' + (d.id || d.ditchName) + '_' + i] || url;
    if (!b64) return;
    html += '<div class="rp-photo-row">' +
      '<div class="rp-photo-img-wrap"><img src="' + b64 + '" alt="' + escHtml(d.ditchName) + '" class="rp-photo-img">' +
        '<div class="rp-photo-label">' + escHtml(d.ditchName) + ' · фото ' + (i+1) + '</div></div>' +
      '<div class="rp-photo-info">' +
        '<div class="rp-photo-info-title">' + escHtml(d.ditchName) + '</div>' +
        '<table class="rp-photo-meta">' +
          '<tr><td>Дата</td><td>' + fmtDate(d.monitoringDate) + '</td></tr>' +
          '<tr><td>Статус</td><td>' + escHtml(d.status||'—') + '</td></tr>' +
          '<tr><td>Q</td><td>' + (d.flowM3h!=null?d.flowM3h.toFixed(3)+' м³/ч':'—') + '</td></tr>' +
        '</table>' +
        (d.comment ? '<div class="rp-photo-comment"><b>Комментарий:</b> ' + escHtml(d.comment) + '</div>' : '') +
      '</div></div>';
  });
  return html ? '<div class="rp-photos-block">' + html + '</div>' : '';
}

// 2D профиль канавы
function buildDitch2DSVG(ditch) {
  var raw = Array.isArray(ditch.depths) ? ditch.depths : [];
  if (!raw.length) return '';
  var all = [0].concat(raw).concat([0]);
  var n = all.length, B = ditch.width || 1;
  var maxH = Math.max.apply(null, all) || 0.01;
  var dx = B / (n - 1);
  var W = 520, H = 200, PL = 48, PR = 16, PT = 38, PB = 42;
  var iW = W-PL-PR, iH = H-PT-PB;
  var scX = iW / (n-1), scY = iH / maxH;
  var pts = all.map(function(h,i){ return { x: PL+i*scX, y: PT+h*scY, h:h }; });
  var groundPoly = pts.map(function(p){ return p.x.toFixed(1)+','+p.y.toFixed(1); }).join(' ') +
    ' '+(PL+iW).toFixed(1)+','+(PT+iH+18)+' '+PL+','+(PT+iH+18);
  var waterPoly = pts.map(function(p){ return p.x.toFixed(1)+','+p.y.toFixed(1); }).join(' ') +
    ' '+(PL+iW).toFixed(1)+','+PT+' '+PL+','+PT;
  var profile = pts.map(function(p){ return p.x.toFixed(1)+','+p.y.toFixed(1); }).join(' ');
  var names = ['Тн'].concat(raw.map(function(_,i){ return 'T'+(i+1); })).concat(['Тк']);
  var sticks = pts.map(function(p,i){
    if (p.h < 0.001) return '';
    return '<line x1="'+p.x.toFixed(1)+'" y1="'+PT+'" x2="'+p.x.toFixed(1)+'" y2="'+p.y.toFixed(1)+'"' +
      ' stroke="'+(i===0||i===n-1?'#bbb':'#f9ab00')+'" stroke-width="1" stroke-dasharray="2,2" opacity=".7"/>';
  }).join('');
  var circles = pts.map(function(p,i){
    var isEnd = i===0||i===n-1;
    return '<circle cx="'+p.x.toFixed(1)+'" cy="'+p.y.toFixed(1)+'" r="'+(isEnd?3:4)+'"' +
      ' fill="'+(isEnd?'#aaa':'#f9ab00')+'" stroke="#fff" stroke-width="1.5"/>';
  }).join('');
  var depthLbls = pts.map(function(p){
    return '<text x="'+p.x.toFixed(1)+'" y="'+(p.y-9).toFixed(1)+'" text-anchor="middle" font-size="8" fill="#1a73e8">'+
      (p.h*100).toFixed(1)+'</text>';
  }).join('');
  var xLbls = pts.map(function(p,i){
    return '<text x="'+p.x.toFixed(1)+'" y="'+(H-PB+12)+'" text-anchor="middle" font-size="9" fill="#666">'+names[i]+'</text>';
  }).join('');
  var distLbls = pts.slice(0,-1).map(function(p,i){
    var mx = (p.x + pts[i+1].x) / 2;
    return '<text x="'+mx.toFixed(1)+'" y="'+(H-PB+22)+'" text-anchor="middle" font-size="7" fill="#aaa">'+dx.toFixed(2)+'м</text>';
  }).join('');
  var ySteps = 4;
  var yAxis = Array.from({length:ySteps+1}).map(function(_,i){
    var hv = maxH*i/ySteps, yp = PT+hv*scY;
    return '<line x1="'+(PL-3)+'" y1="'+yp.toFixed(1)+'" x2="'+PL+'" y2="'+yp.toFixed(1)+'" stroke="#ccc" stroke-width="1"/>' +
      '<text x="'+(PL-5)+'" y="'+yp.toFixed(1)+'" text-anchor="end" font-size="7" dominant-baseline="middle" fill="#999">'+(hv*100).toFixed(0)+'</text>';
  }).join('');
  var S = ditch.area != null ? ditch.area.toFixed(4) : '—';
  var Q = ditch.flowM3h != null ? ditch.flowM3h.toFixed(3) : '—';
  var v = ditch.velocity != null ? ditch.velocity.toFixed(3) : '—';
  var footer = '<text x="'+W/2+'" y="'+(H-2)+'" text-anchor="middle" font-size="9" fill="#666">'+
    'S='+S+' м²  Q='+Q+' м³/ч  v='+v+' м/с  hmax='+(maxH*100).toFixed(1)+' см  B='+B.toFixed(2)+' м</text>';

  return '<div class="rp-ditch-svg-wrap">' +
    '<div class="rp-ditch-svg-title">Профиль поперечного сечения</div>' +
    '<svg width="'+W+'" height="'+H+'" viewBox="0 0 '+W+' '+H+'" style="width:100%;max-width:'+W+'px;display:block;margin:0 auto">' +
      '<polygon points="'+groundPoly+'" fill="#d4a574" opacity=".25"/>' +
      '<polygon points="'+waterPoly+'" fill="#e8f4fd"/>' +
      '<line x1="'+PL+'" y1="'+PT+'" x2="'+(PL+iW).toFixed(1)+'" y2="'+PT+'" stroke="#42a5f5" stroke-width="1.5" stroke-dasharray="4,2" opacity=".6"/>' +
      '<text x="'+(PL+4)+'" y="'+(PT-4)+'" font-size="8" fill="#42a5f5" opacity=".8">поверхность воды</text>' +
      sticks + '<polyline points="'+profile+'" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round"/>' +
      circles + depthLbls + xLbls + distLbls +
      '<line x1="'+PL+'" y1="'+PT+'" x2="'+PL+'" y2="'+(PT+iH)+'" stroke="#ddd" stroke-width="1"/>' + yAxis +
      '<line x1="'+PL+'" y1="'+(PT-18)+'" x2="'+(PL+iW).toFixed(1)+'" y2="'+(PT-18)+'" stroke="#555" stroke-width="1"/>' +
      '<line x1="'+PL+'" y1="'+(PT-22)+'" x2="'+PL+'" y2="'+(PT-14)+'" stroke="#555" stroke-width="1"/>' +
      '<line x1="'+(PL+iW).toFixed(1)+'" y1="'+(PT-22)+'" x2="'+(PL+iW).toFixed(1)+'" y2="'+(PT-14)+'" stroke="#555" stroke-width="1"/>' +
      '<text x="'+(PL+iW/2).toFixed(1)+'" y="'+(PT-20)+'" text-anchor="middle" font-size="10" fill="#555">B='+B.toFixed(2)+' м</text>' +
      footer +
    '</svg></div>';
}

// История замеров канавы
function buildDitchHistTable(name, hist) {
  if (!hist || !hist.length) return '';
  var rows = hist.map(function(h) {
    return '<tr><td>' + escHtml(String(h.monitoringDate||'—')) + '</td>' +
      '<td>' + (h.area!=null?h.area.toFixed(4):'—') + '</td>' +
      '<td><b>' + (h.flowM3h!=null?h.flowM3h.toFixed(3):'—') + '</b></td>' +
      '<td>' + (h.velocity!=null?h.velocity.toFixed(3):'—') + '</td>' +
      '<td>' + escHtml(h.worker||'—') + '</td></tr>';
  }).join('');
  return '<div class="rp-ditch-hist"><div class="rp-section-sub">История замеров</div>' +
    '<table class="rp-table"><thead><tr><th>Дата</th><th>S, м²</th><th>Q, м³/ч</th><th>v, м/с</th><th>Сотрудник</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

// ── Основной HTML отчёта ──────────────────────────────────
function buildReportHTML(s) {
  var ptsA = ReportState.ptsA || [], ptsB = ReportState.ptsB || [];
  var dtsA = ReportState.dtsA || [], dtsB = ReportState.dtsB || [];
  var isSingle = s.reportMode === 'single';
  var ai = ReportState.aiText || {};
  var imgs = ReportState.mapImgs || {};

  var qA = ptsA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
  var qB = ptsB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
  var dtQA = dtsA.reduce(function(a,d){ return a+(d.flowM3h||0); },0);
  var dtQB = dtsB.reduce(function(a,d){ return a+(d.flowM3h||0); },0);
  var dQ = qB - qA;

  var STATUS_COLORS = { 'Новая':'#4f8dff','Активная':'#39d98a','Иссякает':'#f3bf4a','Пересохла':'#ff6b6b','Паводковая':'#a78bfa','Перелив':'#38bdf8' };
  var INTENS_COLORS = { 'Слабая (капёж)':'#8bc8ff','Умеренная':'#39d98a','Сильная (поток)':'#f3bf4a','Очень сильная':'#ff8a4a' };
  var STATUSES  = ['Новая','Активная','Иссякает','Пересохла','Паводковая','Перелив'];
  var INTENSITIES = ['Слабая (капёж)','Умеренная','Сильная (поток)','Очень сильная'];

  function countBy(pts, key) {
    var r = {};
    pts.forEach(function(p){ var v=p[key]||'—'; r[v]=(r[v]||0)+1; });
    return r;
  }

  // ── Титул
  var title = '<div class="rp-title-page">' +
    '<div class="rp-title-logo">ЮРГ</div>' +
    '<h1 class="rp-title-main">Отчёт по мониторингу<br>подземных вод</h1>' +
    '<div class="rp-title-sub">Карьер ЮРГ · Пулково-42</div>' +
    '<div class="rp-title-period">' + (isSingle
      ? 'Дата: ' + fmtDate(s.dateB) + (s.weekB ? ' (' + escHtml(s.weekB) + ')' : '')
      : fmtDate(s.dateA) + ' (' + escHtml(s.weekA) + ') → ' + fmtDate(s.dateB) + ' (' + escHtml(s.weekB) + ')'
    ) + '</div>' +
    '<div class="rp-title-meta">' +
      '<div>Составил: <b>' + escHtml(s.author||'—') + '</b> · ' + escHtml(s.position||'') + '</div>' +
      '<div>Дата: <b>' + fmtDate(s.dateReport) + '</b></div>' +
      '<div style="margin-top:6px;opacity:.5;font-size:11px">v' + s.reportVersion + '</div>' +
    '</div></div>';

  // ── Сводка
  var summaryAI = ai.summary ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + escHtml(ai.summary) + '</div>' : '';

  var summaryContent = '';
  if (isSingle) {
    summaryContent =
      '<div class="rp-kpi-grid">' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsB.length + '</div><div class="rp-kpi-label">Точек мониторинга</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + qB.toFixed(1) + ' <span style="font-size:13px">л/с</span></div><div class="rp-kpi-label">Суммарный водоприток</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsB.filter(function(p){return p.status==='Активная'||p.status==='Паводковая';}).length + '</div><div class="rp-kpi-label">Активных точек</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + dtsB.length + '</div><div class="rp-kpi-label">Канав</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + dtQB.toFixed(1) + ' <span style="font-size:13px">м³/ч</span></div><div class="rp-kpi-label">ΣQ канав</div></div>' +
      '</div>';
  } else {
    var trend = dQ >= 0 ? 'rp-kpi--up' : 'rp-kpi--down';
    summaryContent =
      '<div style="display:grid;grid-template-columns:1fr auto 1fr;gap:12px;align-items:start;margin-bottom:16px">' +
        '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:12px">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:8px">Нед. А · ' + fmtDate(s.dateA) + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsA.length + '</div><div class="rp-kpi-label">Точек</div></div>' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + dtsA.length + '</div><div class="rp-kpi-label">Канав</div></div>' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + qA.toFixed(1) + '</div><div class="rp-kpi-label">Q точек, л/с</div></div>' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + dtQA.toFixed(1) + '</div><div class="rp-kpi-label">Q канав, м³/ч</div></div>' +
          '</div></div>' +
        '<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding-top:20px">' +
          '<div style="font-size:22px;color:#888">→</div>' +
          '<div class="rp-kpi ' + trend + '" style="min-width:80px;text-align:center">' +
            '<div class="rp-kpi-val" style="font-size:16px">' + (dQ>=0?'▲+':'▼') + Math.abs(dQ).toFixed(1) + '</div>' +
            '<div class="rp-kpi-label">Δ л/с</div></div></div>' +
        '<div style="background:#f8f9fa;border:2px solid #1a73e8;border-radius:8px;padding:12px">' +
          '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#1a73e8;margin-bottom:8px">Нед. Б · ' + fmtDate(s.dateB) + '</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsB.length + '</div><div class="rp-kpi-label">Точек</div></div>' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + dtsB.length + '</div><div class="rp-kpi-label">Канав</div></div>' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + qB.toFixed(1) + '</div><div class="rp-kpi-label">Q точек, л/с</div></div>' +
            '<div class="rp-kpi"><div class="rp-kpi-val">' + dtQB.toFixed(1) + '</div><div class="rp-kpi-label">Q канав, м³/ч</div></div>' +
          '</div></div>' +
      '</div>' +
      // Диаграммы
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">' +
        '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:12px">' +
          '<div style="font-size:11px;font-weight:600;margin-bottom:8px">Статус — нед. А (' + ptsA.length + ')</div>' +
          buildDonutSVG(countBy(ptsA,'status'), STATUSES, STATUS_COLORS, ptsA.length) + '</div>' +
        '<div style="background:#f8f9fa;border:2px solid #1a73e8;border-radius:8px;padding:12px">' +
          '<div style="font-size:11px;font-weight:600;color:#1a73e8;margin-bottom:8px">Статус — нед. Б (' + ptsB.length + ')</div>' +
          buildDonutSVG(countBy(ptsB,'status'), STATUSES, STATUS_COLORS, ptsB.length) + '</div>' +
        '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:12px">' +
          '<div style="font-size:11px;font-weight:600;margin-bottom:8px">Интенсивность — нед. А</div>' +
          buildDonutSVG(countBy(ptsA,'intensity'), INTENSITIES, INTENS_COLORS, ptsA.length) + '</div>' +
        '<div style="background:#f8f9fa;border:2px solid #1a73e8;border-radius:8px;padding:12px">' +
          '<div style="font-size:11px;font-weight:600;color:#1a73e8;margin-bottom:8px">Интенсивность — нед. Б</div>' +
          buildDonutSVG(countBy(ptsB,'intensity'), INTENSITIES, INTENS_COLORS, ptsB.length) + '</div>' +
      '</div>';
  }

  // Горизонты
  var horizonContent = '';
  if (isSingle) {
    horizonContent = buildHorizonTable(ptsB, '', '#1a73e8');
  } else {
    horizonContent =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        buildHorizonTable(ptsA, 'Нед. А · ' + fmtDate(s.dateA), '#888') +
        buildHorizonTable(ptsB, 'Нед. Б · ' + fmtDate(s.dateB), '#1a73e8') +
      '</div>';
  }

  // Домены (таблица)
  var domenSet = {}, domenKeys = [];
  ptsA.concat(ptsB).forEach(function(p){ var d=p.domain||p.domen||'—'; if(!domenSet[d]){domenSet[d]=1;domenKeys.push(d);} });
  domenKeys.sort();
  var domenRows = domenKeys.map(function(dom) {
    var dA = ptsA.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
    var dB = ptsB.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
    var qDA = dA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
    var qDB = dB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
    var dd  = qDB - qDA;
    return '<tr><td><b>' + escHtml(dom) + '</b></td>' +
      '<td>' + dA.length + '</td><td>' + qDA.toFixed(2) + '</td>' +
      '<td>' + dB.length + '</td><td>' + qDB.toFixed(2) + '</td>' +
      '<td class="' + (dd>=0?'rp-up':'rp-down') + '">' + (dd>=0?'+':'') + dd.toFixed(2) + '</td></tr>';
  }).join('');

  var summary = '<section class="rp-section"><h2>1. Итоговая сводка</h2>' +
    summaryAI + summaryContent +
    '<div class="rp-section-sub" style="margin-top:14px">Водоприток по горизонтам / уступам</div>' +
    horizonContent +
    (domenRows ? '<div class="rp-section-sub" style="margin-top:14px">Водоприток по доменам</div>' +
      '<table class="rp-table"><thead><tr><th>Домен</th>' +
        (isSingle ? '' : '<th>Точек А</th><th>Q нед. А, л/с</th>') +
        '<th>Точек Б</th><th>Q нед. Б, л/с</th>' +
        (isSingle ? '' : '<th>Δ, л/с</th>') + '</tr></thead><tbody>' +
      domenRows + '</tbody></table>' : '') +
  '</section>';

  // ── Схемы карьера
  var mapSection = '';
  if (s.includeMap && (imgs.imgA || imgs.imgB)) {
    if (isSingle && imgs.imgB) {
      mapSection = '<section class="rp-section"><h2>2. Схема карьера ЮРГ</h2>' +
        '<div class="rp-map-wrap"><img src="' + imgs.imgB + '" alt="Схема" style="width:100%;border:1px solid #dee2e6;border-radius:4px">' +
        '<div class="rp-map-caption">Рис. 1. Схема карьера · ' + fmtDate(s.dateB) + ' (' + escHtml(s.weekB) + ')</div></div></section>';
    } else {
      mapSection = '<section class="rp-section"><h2>2. Схемы карьера ЮРГ — сравнение</h2>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          (imgs.imgA ? '<div class="rp-map-wrap"><img src="' + imgs.imgA + '" alt="Нед. А" style="width:100%;border:1px solid #dee2e6;border-radius:4px">' +
            '<div class="rp-map-caption">Нед. А · ' + fmtDate(s.dateA) + ' (' + escHtml(s.weekA) + ')</div></div>'
            : '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;padding:40px;text-align:center;color:#aaa;font-size:12px">Схема нед. А не загружена</div>') +
          (imgs.imgB ? '<div class="rp-map-wrap"><img src="' + imgs.imgB + '" alt="Нед. Б" style="width:100%;border:2px solid #1a73e8;border-radius:4px">' +
            '<div class="rp-map-caption" style="color:#1a73e8">Нед. Б · ' + fmtDate(s.dateB) + ' (' + escHtml(s.weekB) + ')</div></div>'
            : '<div style="background:#e8f0fe;border:2px solid #1a73e8;border-radius:4px;padding:40px;text-align:center;color:#1a73e8;font-size:12px">Схема нед. Б не загружена</div>') +
        '</div></section>';
    }
  }

  // ── По доменам (детально)
  var domensSection = '';
  if (s.includeDomens) {
    var n = mapSection ? 3 : 2;
    domensSection = '<section class="rp-section"><h2>' + n + '. По доменам</h2>';
    domenKeys.forEach(function(dom) {
      var dA = ptsA.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
      var dB = ptsB.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
      if (!dA.length && !dB.length) return;
      var qDA = dA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
      var qDB = dB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
      var dd  = qDB - qDA;
      // Сводная строка домена
      var domHeader = '<div class="rp-domen-block">' +
        '<div class="rp-domen-header">' +
          '<span class="rp-domen-name">' + escHtml(dom) + '</span>' +
          '<span class="rp-domen-badge">' + (isSingle?dB.length:dA.length+'→'+dB.length) + ' точек</span>' +
          '<span class="rp-domen-q">Q = ' + qDB.toFixed(2) + ' л/с</span>' +
          (!isSingle && qDA>0 ? '<span class="rp-delta ' + (dd>=0?'up':'down') + '">' + (dd>=0?'▲+':'▼') + dd.toFixed(2) + ' л/с</span>' : '') +
        '</div>';

      // Сводная таблица точек домена
      var tableRows = dB.map(function(pb) {
        var pa = dA.find(function(p){ return p.pointNumber===pb.pointNumber; });
        var qa = pa ? parseFloat(pa.flowRate)||0 : null;
        var qb = parseFloat(pb.flowRate)||0;
        var delta = qa!==null ? qb-qa : null;
        return '<tr>' +
          '<td><b>' + escHtml(String(pb.pointNumber)) + '</b></td>' +
          '<td>' + escHtml(pb.status||'—') + '</td>' +
          '<td>' + escHtml(pb.intensity||'—') + '</td>' +
          (isSingle ? '' : '<td>' + (qa!==null?qa.toFixed(2):'—') + '</td>') +
          '<td><b>' + qb.toFixed(2) + '</b></td>' +
          (isSingle ? '' : '<td class="' + (delta!==null?(delta>=0?'rp-up':'rp-down'):'') + '">' + (delta!==null?(delta>=0?'+':'')+delta.toFixed(2):'—') + '</td>') +
          '<td>' + escHtml(pb.waterColor||'—') + '</td>' +
          '<td>' + escHtml(pb.measureMethod||'—') + '</td>' +
        '</tr>';
      }).join('');

      var domTable = '<table class="rp-table"><thead><tr>' +
        '<th>№</th><th>Статус</th><th>Интенсивность</th>' +
        (isSingle ? '' : '<th>Q нед. А</th>') +
        '<th>Q нед. Б</th>' +
        (isSingle ? '' : '<th>Δ</th>') +
        '<th>Цвет</th><th>Метод</th>' +
      '</tr></thead><tbody>' + tableRows + '</tbody></table>';

      // Карточки точек (фото + график)
      var pointCards = '';
      if (s.includePhotos || s.includeHistory) {
        pointCards = dB.map(function(pb) {
          var pa = dA.find(function(p){ return p.pointNumber===pb.pointNumber; });
          return buildPointCard(pb, pa||null, s);
        }).join('');
      }

      domensSection += domHeader + domTable +
        (pointCards ? '<div style="padding:10px 12px;border-top:1px solid #e9ecef;background:#fafbfc">' + pointCards + '</div>' : '') +
        '</div>';
    });
    domensSection += '</section>';
  }

  // ── Канавы
  var ditchesSection = '';
  if (s.includeDitches) {
    var dToShow = dtsB.length ? dtsB : dtsA;
    if (dToShow.length) {
      var dn = (mapSection ? 1 : 0) + (domensSection ? 1 : 0) + 3;
      ditchesSection = '<section class="rp-section"><h2>' + dn + '. Канавы — детальные данные</h2>';
      dToShow.forEach(function(d) {
        var hist = ReportState.history[d.ditchName] || [];
        ditchesSection +=
          '<div class="rp-ditch-block">' +
            '<div class="rp-ditch-header">' +
              '<span class="rp-ditch-icon">≈</span>' +
              '<span class="rp-ditch-name">' + escHtml(d.ditchName) + '</span>' +
              '<span class="rp-ditch-status">' + escHtml(d.status||'Активная') + '</span>' +
            '</div>' +
            '<div class="rp-ditch-grid">' +
              '<div class="rp-param"><span class="rp-param-l">Дата</span><span class="rp-param-v">' + fmtDate(d.monitoringDate) + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Сотрудник</span><span class="rp-param-v">' + escHtml(d.worker||'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Ширина B</span><span class="rp-param-v">' + (d.width!=null?d.width.toFixed(2)+' м':'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Метод v</span><span class="rp-param-v">' + escHtml(d.velMethod==='float'?'Поплавок':d.velMethod==='multi'?'По точкам':'Одна v') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">v, м/с</span><span class="rp-param-v">' + (d.velocity!=null?d.velocity.toFixed(3):'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">S, м²</span><span class="rp-param-v">' + (d.area!=null?d.area.toFixed(4):'—') + '</span></div>' +
              '<div class="rp-param rp-param--accent"><span class="rp-param-l">Q, м³/ч</span><span class="rp-param-v">' + (d.flowM3h!=null?d.flowM3h.toFixed(3):'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Глубины</span><span class="rp-param-v">' + (Array.isArray(d.depths)?d.depths.map(function(h){return (h*100).toFixed(1)+'см';}).join(', '):'—') + '</span></div>' +
            '</div>' +
            (d.comment ? '<div class="rp-comment"><b>Комментарий:</b> ' + escHtml(d.comment) + '</div>' : '') +
            buildDitch2DSVG(d) +
            buildDitchHistTable(d.ditchName, hist) +
            (s.includePhotos ? buildDitchPhotos(d) : '') +
          '</div>';
      });
      ditchesSection += '</section>';
    }
  }

  // ── Сравнение А vs Б
  var compareSection = '';
  if (!isSingle && s.includeCompare && ptsA.length && ptsB.length) {
    var cmpAI = ai.compare ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + escHtml(ai.compare) + '</div>' : '';
    var cmpRows = ptsB.map(function(pb) {
      var pa = ptsA.find(function(p){ return p.pointNumber===pb.pointNumber; });
      var qa = pa ? parseFloat(pa.flowRate)||0 : null;
      var qb = parseFloat(pb.flowRate)||0;
      var delta = qa!==null ? qb-qa : null;
      var pct   = (qa&&qa>0) ? (qb-qa)/qa*100 : null;
      var alert = delta!==null&&Math.abs(pct)>=30 ? (delta>0?'⚠ рост':'✓ снижение') : '';
      return '<tr class="' + (alert?'rp-row--alert':'') + '">' +
        '<td><b>' + escHtml(String(pb.pointNumber)) + '</b></td>' +
        '<td>' + escHtml(pb.domain||pb.domen||'—') + '</td>' +
        '<td>' + escHtml(pb.status||'—') + '</td>' +
        '<td>' + (qa!==null?qa.toFixed(2):'—') + '</td>' +
        '<td><b>' + qb.toFixed(2) + '</b></td>' +
        '<td class="' + (delta!==null?(delta>=0?'rp-up':'rp-down'):'') + '">' + (delta!==null?(delta>=0?'+':'')+delta.toFixed(2):'—') + '</td>' +
        '<td class="' + (pct!==null?(pct>=0?'rp-up':'rp-down'):'') + '">' + (pct!==null?(pct>=0?'+':'')+pct.toFixed(0)+'%':'—') + '</td>' +
        '<td>' + escHtml(alert) + '</td></tr>';
    }).join('');
    var cnSec = 5;
    compareSection = '<section class="rp-section"><h2>' + cnSec + '. Сравнение: ' + fmtDate(s.dateA) + ' (' + escHtml(s.weekA) + ') vs ' + fmtDate(s.dateB) + ' (' + escHtml(s.weekB) + ')</h2>' +
      cmpAI +
      '<table class="rp-table"><thead><tr><th>№</th><th>Домен</th><th>Статус</th>' +
        '<th>Q нед. А, л/с</th><th>Q нед. Б, л/с</th><th>Δ, л/с</th><th>Δ, %</th><th>Оценка</th></tr></thead><tbody>' +
      cmpRows +
      '<tr class="rp-row--total"><td colspan="3"><b>Итого</b></td>' +
        '<td><b>' + qA.toFixed(2) + '</b></td><td><b>' + qB.toFixed(2) + '</b></td>' +
        '<td class="' + (dQ>=0?'rp-up':'rp-down') + '"><b>' + (dQ>=0?'+':'') + dQ.toFixed(2) + '</b></td>' +
        '<td class="' + (dQ>=0?'rp-up':'rp-down') + '"><b>' + (qA>0?(dQ>=0?'+':'')+( dQ/qA*100).toFixed(0)+'%':'—') + '</b></td><td></td></tr>' +
      '</tbody></table></section>';
  }

  // ── Заключение
  var aiRec = ai.recommendations ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + escHtml(ai.recommendations) + '</div>' : '';
  var concl = '<section class="rp-section"><h2>6. Заключение и рекомендации</h2>' +
    aiRec +
    (s.conclusions
      ? '<div class="rp-conclusion-text">' + escHtml(s.conclusions).replace(/\n/g,'<br>') + '</div>'
      : '<div class="rp-conclusion-text rp-conclusion-text--empty">Заключение не заполнено</div>') +
  '</section>';

  return '<!DOCTYPE html><html lang="ru"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Отчёт — Карьер ЮРГ — ' + fmtDate(s.dateB) + '</title>' +
    '<style>' + getReportCSS() + '</style></head><body>' +
    title +
    '<div class="rp-body">' + summary + mapSection + domensSection + ditchesSection + compareSection + concl + '</div>' +
    '<div class="rp-footer"><div>Карьер ЮРГ · Мониторинг подземных вод · ' + fmtDate(s.dateReport) + '</div><div>v' + s.reportVersion + '</div></div>' +
    '<div class="rp-print-btn no-print">' +
      '<button onclick="window.print()">🖨 Печать / PDF</button>' +
      '<button onclick="window.close()" style="margin-left:8px">✕ Закрыть</button>' +
    '</div></body></html>';
}

// ── CSS отчёта ─────────────────────────────────────────────
function getReportCSS() {
  return [
  '* { box-sizing: border-box; margin: 0; padding: 0; }',
  'body { font-family: Arial, sans-serif; font-size: 12px; color: #222; background: #fff; line-height: 1.5; }',
  '.rp-title-page { display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;border-bottom:3px solid #1a73e8;page-break-after:always; }',
  '.rp-title-logo { width:56px;height:56px;border-radius:50%;background:#1a73e8;color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;margin:0 auto 14px; }',
  '.rp-title-main { font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:8px; }',
  '.rp-title-sub  { font-size:13px;color:#555;margin-bottom:14px; }',
  '.rp-title-period { background:#e8f0fe;border-radius:6px;padding:8px 20px;font-size:13px;color:#1a73e8;font-weight:500;margin-bottom:18px; }',
  '.rp-title-meta { font-size:12px;color:#444;line-height:1.8; }',
  '.rp-body { max-width:860px;margin:0 auto;padding:20px 30px; }',
  '.rp-section { margin-bottom:24px; }',
  '.rp-section h2 { font-size:14px;font-weight:700;color:#1a1a2e;padding:5px 0;border-bottom:2px solid #1a73e8;margin-bottom:12px; }',
  '.rp-section-sub { font-size:12px;font-weight:600;color:#444;margin:12px 0 6px; }',
  '.rp-kpi-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px; }',
  '.rp-kpi { background:#f8f9fa;border-radius:6px;padding:10px 12px;border:1px solid #e9ecef; }',
  '.rp-kpi-val { font-size:20px;font-weight:700;color:#1a73e8;line-height:1.2; }',
  '.rp-kpi-label { font-size:10px;color:#666;margin-top:2px; }',
  '.rp-kpi--up .rp-kpi-val { color:#d93025; }',
  '.rp-kpi--down .rp-kpi-val { color:#188038; }',
  '.rp-table { width:100%;border-collapse:collapse;font-size:11px; }',
  '.rp-table th { background:#f8f9fa;font-weight:600;padding:5px 8px;text-align:left;border-bottom:1px solid #dee2e6;color:#555;font-size:10px;text-transform:uppercase;letter-spacing:.04em; }',
  '.rp-table td { padding:5px 8px;border-bottom:1px solid #f0f0f0; }',
  '.rp-table tr:last-child td { border-bottom:none; }',
  '.rp-row--alert td { background:#fff8e1; }',
  '.rp-row--total td { background:#f1f3f4;font-weight:600;border-top:1px solid #dee2e6; }',
  '.rp-up { color:#d93025; } .rp-down { color:#188038; }',
  '.rp-domen-block { border:1px solid #dee2e6;border-radius:6px;margin-bottom:12px;overflow:hidden; }',
  '.rp-domen-header { display:flex;align-items:center;gap:10px;background:#f1f3f4;padding:7px 12px;border-bottom:1px solid #dee2e6;flex-wrap:wrap; }',
  '.rp-domen-name { font-weight:700;font-size:13px;color:#1a1a2e; }',
  '.rp-domen-badge { background:#e8f0fe;color:#1967d2;font-size:10px;padding:1px 7px;border-radius:10px;font-weight:500; }',
  '.rp-domen-q { font-size:12px;color:#444;margin-left:auto; }',
  '.rp-delta { font-size:11px;font-weight:600;padding:1px 6px;border-radius:3px; }',
  '.rp-delta.up { color:#d93025;background:#fce8e6; } .rp-delta.down { color:#188038;background:#e6f4ea; }',
  '.rp-ditch-block { border:1px solid #dee2e6;border-radius:6px;margin-bottom:16px;overflow:hidden; }',
  '.rp-ditch-header { display:flex;align-items:center;gap:8px;background:#e8f4fd;padding:7px 12px;border-bottom:1px solid #c8e1f5; }',
  '.rp-ditch-icon { font-size:16px;color:#1a73e8; }',
  '.rp-ditch-name { font-weight:700;font-size:13px;color:#1a1a2e; }',
  '.rp-ditch-status { background:#1a73e8;color:#fff;font-size:10px;padding:1px 7px;border-radius:10px;margin-left:auto; }',
  '.rp-ditch-grid { display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#dee2e6;border-bottom:1px solid #dee2e6; }',
  '.rp-param { background:#fff;padding:6px 10px; } .rp-param--accent { background:#f8fff8; }',
  '.rp-param-l { display:block;font-size:9px;color:#888;text-transform:uppercase;letter-spacing:.04em;margin-bottom:1px; }',
  '.rp-param-v { font-size:12px;font-weight:600;color:#222; }',
  '.rp-param--accent .rp-param-v { color:#188038; }',
  '.rp-comment { padding:6px 10px;font-size:11px;color:#555;background:#fffde7;border-top:1px solid #ffe082; }',
  '.rp-ditch-svg-wrap { padding:8px 12px;border-top:1px solid #f0f0f0; }',
  '.rp-ditch-svg-title { font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:6px;text-align:center; }',
  '.rp-ditch-hist { padding:0 12px 10px; }',
  '.rp-photos-block { padding:10px 12px;border-top:1px solid #f0f0f0;display:flex;flex-direction:column;gap:12px; }',
  '.rp-photo-row { display:flex;gap:12px;align-items:flex-start;border:1px solid #e9ecef;border-radius:6px;overflow:hidden; }',
  '.rp-photo-img-wrap { flex:0 0 280px;background:#f8f9fa; }',
  '.rp-photo-img { width:280px;height:210px;object-fit:cover;display:block; }',
  '.rp-photo-label { font-size:9px;color:#888;text-align:center;padding:3px;background:#f1f3f4; }',
  '.rp-photo-info { flex:1;padding:10px 12px;min-width:0; }',
  '.rp-photo-info-title { font-size:13px;font-weight:700;color:#1a1a2e;margin-bottom:8px; }',
  '.rp-photo-meta { width:100%;border-collapse:collapse;font-size:11px;margin-bottom:8px; }',
  '.rp-photo-meta td { padding:3px 0;vertical-align:top; }',
  '.rp-photo-meta td:first-child { color:#888;width:110px;font-size:10px;text-transform:uppercase;letter-spacing:.04em; }',
  '.rp-photo-meta td:last-child { color:#222;font-weight:500; }',
  '.rp-photo-comment { font-size:11px;color:#444;background:#f8f9fa;border-left:3px solid #1a73e8;border-radius:0 4px 4px 0;padding:6px 8px;line-height:1.5; }',
  '.rp-photo-comment--empty { color:#aaa;font-style:italic;border-left-color:#dee2e6; }',
  '.rp-ai-text { background:#f3f0ff;border-left:3px solid #7f77dd;border-radius:0 5px 5px 0;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#333;line-height:1.6; }',
  '.rp-ai-badge { display:inline-block;background:#7f77dd;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:6px;letter-spacing:.05em; }',
  '.rp-map-wrap { margin-top:10px; }',
  '.rp-map-caption { font-size:10px;color:#888;text-align:center;margin-top:4px;font-style:italic; }',
  '.rp-conclusion-text { background:#f8f9fa;border-radius:5px;padding:10px 14px;font-size:12px;line-height:1.7;color:#333;white-space:pre-wrap; }',
  '.rp-conclusion-text--empty { color:#aaa;font-style:italic; }',
  '.rp-footer { display:flex;justify-content:space-between;max-width:860px;margin:20px auto 0;padding:12px 30px;font-size:10px;color:#aaa;border-top:1px solid #e9ecef; }',
  '.rp-print-btn { position:fixed;bottom:20px;right:20px;z-index:100; }',
  '.rp-print-btn button { padding:10px 20px;font-size:13px;cursor:pointer;background:#1a73e8;color:#fff;border:none;border-radius:6px;font-weight:500; }',
  '@media print {',
  '  @page { margin:15mm 18mm;size:A4 portrait; }',
  '  .no-print { display:none !important; }',
  '  body { font-size:11px; }',
  '  * { -webkit-print-color-adjust:exact;print-color-adjust:exact; }',
  '  .rp-title-page { page-break-after:always; }',
  '  .rp-body { padding:0 !important;max-width:100% !important; }',
  '  .rp-domen-block,.rp-ditch-block,.rp-photo-row,.rp-kpi-grid { page-break-inside:avoid;break-inside:avoid; }',
  '  .rp-photo-img-wrap { flex:0 0 200px !important; }',
  '  .rp-photo-img { width:200px !important;height:150px !important; }',
  '  .rp-map-wrap img,.rp-ditch-block img { max-width:100% !important;height:auto !important;max-height:220px !important; }',
  '}'
  ].join('\n');
}
