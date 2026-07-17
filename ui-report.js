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
    conclusions: '', apiKey: '',
    aiModel: 'gemini-1.5-flash',
    aiTone: 'official',
    quarryName: 'ЮРГ',
    objectName: 'Пулково-42',
    reportTheme: 'blue',
    reportLayout: 'a',
    orientation: 'portrait',
    filterDomains:  [],   // [] = all domains
    filterHorizons: [],   // [] = all horizons
    includeWells: true,
  },
  currentStep: 1,
};

// ── Утилиты ───────────────────────────────────────────────

var RP_SECTIONS = [
  { id: 'map',        chk: 'rp-inc-map',        label: 'Схема карьера',      icon: '🗺',  defOn: true  },
  { id: 'domens',     chk: 'rp-inc-domens',      label: 'Домены / горизонты', icon: '📊',  defOn: true  },
  { id: 'dewatering', chk: 'rp-inc-dewatering',  label: 'Водоотлив',          icon: '💧',  defOn: false },
  { id: 'wells',      chk: 'rp-inc-wells',       label: 'Гор. скважины',      icon: '⊛',  defOn: true  },
  { id: 'ditches',    chk: 'rp-inc-ditches',     label: 'Дренажные канавы',   icon: '🏗',  defOn: true  },
  { id: 'photos',     chk: 'rp-inc-photos',      label: 'Фото точек',         icon: '📷',  defOn: true  },
  { id: 'history',    chk: 'rp-inc-history',     label: 'История (графики)',  icon: '📈',  defOn: true  },
  { id: 'compare',    chk: 'rp-inc-compare',     label: 'Сравнение А vs Б',   icon: '🔄',  defOn: false },
  { id: 'ai',         chk: 'rp-inc-ai',          label: 'AI-заключение',      icon: '🤖',  defOn: true  },
];

// Рендер текста от AI: экранирует HTML + рендерит **bold** и переносы строк
function renderAIText(text) {
  if (!text) return '';
  return escHTML(text)
    .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/\n/g, '<br>');
}

function fmtDate(d) {
  if (!d) return '—';
  var p = String(d).split('-');
  return p.length === 3 ? p[2]+'.'+p[1]+'.'+p[0] : d;
}
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
  var a = getField('rp-date-a'), b = getField('rp-date-b');
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

function getChk(id) {
  var el = document.getElementById(id);
  return el ? el.checked : undefined;
}

function restoreChk(id, val) {
  if (val === null || val === undefined) return;
  var el = document.getElementById(id);
  if (el) el.checked = val;
}

// ── Инициализация ─────────────────────────────────────────
function initReportTab() {
  var root = document.getElementById('report-root');
  if (!root) return;
  root.innerHTML = buildSettingsUI();
  switchStep(1);
  bindEvents();
  restoreSettings();
}

function restoreSettings() {
  var s = {};
  try { s = JSON.parse(localStorage.getItem('report-settings') || '{}'); } catch(e) {}
  if (s.author)        setField('rp-author',        s.author);
  if (s.position)      setField('rp-position',      s.position);
  if (s.apiKey)        setField('rp-apikey',        s.apiKey);
  if (s.customPrompt)  setField('rp-custom-prompt', s.customPrompt);
  if (s.quarryName)    setField('rp-quarry-name',   s.quarryName);
  if (s.objectName)    setField('rp-object-name',   s.objectName);
  if (s.filterDomains)  ReportState.settings.filterDomains  = s.filterDomains;
  if (s.filterHorizons) ReportState.settings.filterHorizons = s.filterHorizons;
  setField('rp-date', new Date().toISOString().slice(0, 10));
  restoreChk('rp-inc-map',        s.incMap);
  restoreChk('rp-inc-domens',     s.incDomens);
  restoreChk('rp-inc-photos',     s.incPhotos);
  restoreChk('rp-inc-history',    s.incHistory);
  restoreChk('rp-inc-ditches',    s.incDitches);
  restoreChk('rp-inc-compare',    s.incCompare);
  restoreChk('rp-inc-ai',         s.incAI);
  restoreChk('rp-inc-dewatering', s.incDewatering);
  restoreChk('rp-inc-wells',      s.incWells !== false ? true : false); // default true
  // Sync the AI toggle and collapse body if disabled
  var aiCb = document.getElementById('rp-inc-ai-cb');
  if (aiCb && s.incAI !== undefined) {
    aiCb.checked = s.incAI;
    var aiBody = document.getElementById('rp-ai-settings-body');
    if (aiBody) aiBody.style.display = s.incAI ? '' : 'none';
  }

  if (s.reportTheme) {
    ReportState.settings.reportTheme = s.reportTheme;
    // Mark the correct theme card active
    document.querySelectorAll('.rp-theme-card').forEach(function(c){ c.classList.toggle('rp-theme-card--active', c.dataset.theme === s.reportTheme); });
  }
  if (s.reportLayout) {
    ReportState.settings.reportLayout = s.reportLayout;
    document.querySelectorAll('.rp-layout-card').forEach(function(c){
      c.classList.toggle('rp-layout-card--active', c.dataset.layout === s.reportLayout);
    });
  }
  if (s.orientation) {
    rpSetOrientation(s.orientation);
  }
  // Restore logo preview
  var savedLogo = localStorage.getItem('rp-logo-base64');
  if (savedLogo) rpLogoUpdatePreview(savedLogo);
  // Restore watermark
  if (s.watermark) {
    var wmSel = document.getElementById('rp-watermark');
    if (wmSel) {
      var isCustom = !['','ДСП','Внутренний','Для заказчика','Черновик'].includes(s.watermark);
      wmSel.value = isCustom ? 'custom' : s.watermark;
      var wrap = document.getElementById('rp-watermark-custom-wrap');
      if (wrap) wrap.style.display = isCustom ? '' : 'none';
      if (isCustom) setField('rp-watermark-custom', s.watermark);
    }
  }
  if (s.approverName) setField('rp-approver-name', s.approverName);
  restoreChk('rp-inc-signature', s.incSignature);
  if (s.aiModel) { ReportState.settings.aiModel = s.aiModel; setField('rp-ai-model', s.aiModel); }
  if (s.aiTone)  { ReportState.settings.aiTone  = s.aiTone;  setField('rp-ai-tone',  s.aiTone);  }

  // Если данные уже были загружены — восстанавливаем даты
  var allDates = ReportState.allDates || [];
  if (allDates.length > 0) {
    var savedDateA = s.dateA || (allDates.length >= 2 ? allDates[allDates.length-2] : allDates[0]);
    var savedDateB = s.dateB || allDates[allDates.length-1];
    fillDateDropdown('rp-date-a', allDates, savedDateA);
    fillDateDropdown('rp-date-b', allDates, savedDateB);
    // Активируем кнопку формирования
    var genBtn = document.getElementById('rp-generate-btn');
    if (genBtn) { genBtn.style.opacity='1'; genBtn.style.pointerEvents=''; }
    // Обновляем строку статуса данных
    var sumEl = document.getElementById('rp-data-summary');
    if (sumEl && !sumEl.textContent) {
      var domains = [];
      var ds = {};
      (ReportState.allPoints||[]).forEach(function(p){
        var d=p.domain||p.domen||'—'; if(!ds[d]){ds[d]=1;domains.push(d);}
      });
      sumEl.innerHTML = '<span style="color:var(--blue)">▸ Точек: <b>' + (ReportState.allPoints||[]).length + '</b></span>&nbsp;&nbsp;' +
        '<span style="color:var(--gold)">▸ Канав: <b>' + (ReportState.allDitches||[]).length + '</b></span>&nbsp;&nbsp;' +
        '<span style="color:var(--txt-2)">▸ Дат: <b>' + allDates.length + '</b></span>&nbsp;&nbsp;' +
        '<span style="color:var(--txt-2)">▸ Домены: <b>' + domains.join(', ') + '</b></span>';
      var statusEl = document.getElementById('rp-data-status');
      if (statusEl) statusEl.style.display = '';
    }
  }

  // Восстанавливаем режим
  var mode = s.reportMode || 'single';
  ReportState.settings.reportMode = mode;
  setReportMode(mode);
  updateRpPreviewPanel();
  // Update author info in steps sidebar
  var infoEl = document.getElementById('rp-steps-author-info');
  if (infoEl && s.author) infoEl.textContent = s.author + ' · v' + (s.reportVersion || 1);
  if ((ReportState.allPoints || []).length > 0) renderRpFilters();
}

function saveReportSettings() {
  try {
    localStorage.setItem('report-settings', JSON.stringify({
      author:        getField('rp-author'),
      position:      getField('rp-position'),
      apiKey:        getField('rp-apikey'),
      customPrompt:  getField('rp-custom-prompt'),
      quarryName:    getField('rp-quarry-name'),
      objectName:    getField('rp-object-name'),
      reportVersion: ReportState.settings.reportVersion,
      reportMode:    ReportState.settings.reportMode || 'single',
      incMap:        getChk('rp-inc-map'),
      incDomens:     getChk('rp-inc-domens'),
      incPhotos:     getChk('rp-inc-photos'),
      incHistory:    getChk('rp-inc-history'),
      incDitches:    getChk('rp-inc-ditches'),
      incCompare:    getChk('rp-inc-compare'),
      incAI:         getChk('rp-inc-ai'),
      incDewatering: getChk('rp-inc-dewatering'),
      incWells:      getChk('rp-inc-wells'),
      reportTheme:   ReportState.settings.reportTheme || 'blue',
      reportLayout:  ReportState.settings.reportLayout || 'a',
      orientation:   ReportState.settings.orientation  || 'portrait',
      watermark:    (function(){ var v=getField('rp-watermark'); return v==='custom'?getField('rp-watermark-custom'):v; })(),
      approverName: getField('rp-approver-name'),
      incSignature: getChk('rp-inc-signature'),
      aiModel: getField('rp-ai-model') || 'gemini-1.5-flash',
      aiTone:  getField('rp-ai-tone')  || 'official',
      filterDomains:  ReportState.settings.filterDomains  || [],
      filterHorizons: ReportState.settings.filterHorizons || [],
    }));
  } catch(e) {}
}

function fillPresetSelect(keepValue) {
  var sel = document.getElementById('rp-preset-select');
  if (!sel) return;
  var prevValue = keepValue || sel.value || '';
  var prompts = getPromptsBank();
  sel.innerHTML = '<option value="">— выбрать из банка —</option>';
  prompts.forEach(function(p) {
    var opt = document.createElement('option');
    opt.value = p.text;
    opt.textContent = p.name;
    opt.title = p.desc;
    if (prevValue && p.text === prevValue) opt.selected = true;
    sel.appendChild(opt);
  });
}

function onPresetChange(sel) {
  if (!sel.value) return;
  setField('rp-custom-prompt', sel.value);
  saveReportSettings();
  // НЕ сбрасываем sel.value — пусть отображается название
  Toast.show('Промпт загружен — можно редактировать', 'success');
}

function bindEvents() {
  ['rp-author','rp-position','rp-apikey','rp-quarry-name','rp-object-name','rp-approver-name'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('input', saveReportSettings);
  });
  ['rp-inc-map','rp-inc-domens','rp-inc-photos','rp-inc-history',
   'rp-inc-ditches','rp-inc-compare','rp-inc-ai','rp-inc-dewatering','rp-inc-signature'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', saveReportSettings);
  });
  // Инициализируем выпадающий список промптов
  fillPresetSelect();
  // Initialize sections list after first render
  setTimeout(function(){ renderSectionsList(); }, 0);
  ['rp-ai-model','rp-ai-tone'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.addEventListener('change', function() {
      ReportState.settings.aiModel = getField('rp-ai-model') || 'gemini-1.5-flash';
      ReportState.settings.aiTone  = getField('rp-ai-tone')  || 'official';
      saveReportSettings();
    });
  });
  setTimeout(updateAICacheInfo, 100);
}

// ── UI настроек ───────────────────────────────────────────



// ── Банк промптов ─────────────────────────────────────────
var DEFAULT_PROMPTS = [
  {
    id: 'default-1',
    category: 'Общий',
    name: 'Стандартный: обстановка + риски',
    desc: 'Еженедельный отчёт. Описывает общую гидрогеологическую обстановку, выделяет паводковые зоны и точки с аномальным Q.',
    text: 'Составь краткий профессиональный вывод по гидрогеологической обстановке карьера ЮРГ. Укажи основные зоны водопритока, горизонты с максимальным Q, состояние паводковых точек и аномальные изменения. Без рекомендаций.'
  },
  {
    id: 'default-2',
    category: 'Риски',
    name: 'Паводковый анализ',
    desc: 'Акцент на паводковые точки и точки "Перелив". Оценивает угрозу для горных работ.',
    text: 'Проанализируй паводковые точки и точки со статусом "Перелив". Оцени масштаб обводнённости и потенциальную угрозу для ведения горных работ. Укажи борта карьера и горизонты с наибольшим риском. Без рекомендаций.'
  },
  {
    id: 'default-3',
    category: 'Общий',
    name: 'Краткая сводка для руководства',
    desc: '2-3 предложения без технических деталей. Для управленческой аудитории.',
    text: 'Дай краткую сводку (2-3 предложения) по водопритоку карьера. Только ключевые факты: суммарный Q, основные зоны, критические точки. Нетехнический язык, без специализированных терминов.'
  },
  {
    id: 'default-4',
    category: 'Сравнение',
    name: 'Сравнительный анализ периодов',
    desc: 'Для режима "Сравнение недель". Описывает динамику изменений Q между двумя датами.',
    text: 'Составь сравнительный анализ двух периодов мониторинга. Укажи динамику суммарного Q, зоны с ростом и снижением водопритока, изменения статусов точек. Без рекомендаций.'
  }
];

function getPromptsBank() {
  try {
    var saved = JSON.parse(localStorage.getItem('rp-prompts-bank') || '[]');
    // Объединяем дефолтные + пользовательские (пользовательские идут первыми)
    var ids = saved.map(function(p){ return p.id; });
    var defaults = DEFAULT_PROMPTS.filter(function(p){ return ids.indexOf(p.id) < 0; });
    return saved.concat(defaults);
  } catch(e) { return DEFAULT_PROMPTS.slice(); }
}

function savePromptsBank(prompts) {
  try {
    // Сохраняем только пользовательские (не дефолтные)
    var userPrompts = prompts.filter(function(p){ return p.id.indexOf('default-') < 0; });
    localStorage.setItem('rp-prompts-bank', JSON.stringify(userPrompts));
  } catch(e) {}
}

function addPromptToBank(name, desc, text, category) {
  if (!name || !text) return false;
  var prompts = getPromptsBank().filter(function(p){ return p.id.indexOf('default-') < 0; });
  prompts.push({ id: 'u-' + Date.now(), name: name, desc: desc, text: text, category: category || 'Мои' });
  savePromptsBank(prompts);
  return true;
}

function deletePromptFromBank(id) {
  if (!id || id.indexOf('default-') === 0) return false; // нельзя удалить дефолтные
  var prompts = getPromptsBank().filter(function(p){ return p.id.indexOf('default-') < 0 && p.id !== id; });
  savePromptsBank(prompts);
  return true;
}

function updatePromptInBank(id, name, desc, text) {
  if (!id || id.indexOf('default-') === 0) return false;
  var prompts = getPromptsBank().filter(function(p){ return p.id.indexOf('default-') < 0; });
  var idx = -1;
  prompts.forEach(function(p,i){ if(p.id===id) idx=i; });
  if (idx >= 0) { prompts[idx] = {id:id, name:name, desc:desc, text:text}; }
  savePromptsBank(prompts);
  return true;
}

function applyPrompt(text) {
  setField('rp-custom-prompt', text);
  saveReportSettings();
  Toast.show('Промпт применён', 'success');
}

function renderPromptsTab(filterCat) {
  var root = document.getElementById('rp-tab-prompts');
  if (!root) return;
  var allPrompts = getPromptsBank();
  window._rpPrompts = allPrompts;

  // Collect all categories
  var catSet = {}, cats = [];
  allPrompts.forEach(function(p){ var c = p.category || 'Общий'; if(!catSet[c]){catSet[c]=1;cats.push(c);} });

  var activeCat = filterCat || window._rpActiveCat || 'все';
  window._rpActiveCat = activeCat;
  var filtered = activeCat === 'все' ? allPrompts : allPrompts.filter(function(p){ return (p.category||'Общий') === activeCat; });

  var catTabs = '<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:10px">' +
    ['все'].concat(cats).map(function(c) {
      var active = c === activeCat;
      return '<button onclick="renderPromptsTab(\'' + c + '\')" style="padding:3px 10px;border-radius:12px;font-size:11px;cursor:pointer;border:1px solid var(--line-2);' +
        (active ? 'background:var(--blue,#2563eb);color:#fff;border-color:transparent' : 'background:transparent;color:var(--txt-2)') + '">' + c + '</button>';
    }).join('') +
  '</div>';

  var html = catTabs + '<div style="margin-bottom:14px">';
  filtered.forEach(function(p) {
    // find original index in allPrompts
    var origIdx = allPrompts.indexOf(p);
    var isDefault = p.id.indexOf('default-') === 0;
    var borderColor = isDefault ? '#1a73e8' : '#f9ab00';
    var catBadge = p.category ? '<span style="font-size:9px;padding:1px 6px;border-radius:3px;background:var(--card-bg2);color:var(--txt-3);margin-left:4px">' + escHTML(p.category) + '</span>' : '';
    html += '<div style="border:0.5px solid var(--line-2);border-radius:10px;padding:12px 14px;margin-bottom:10px;background:var(--card-bg)">' +
      '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">' +
        '<div style="flex:1;min-width:0">' +
          '<div style="font-weight:600;font-size:13px;color:var(--txt-1);margin-bottom:3px">' + escAttr(p.name) +
            (isDefault ? '<span style="font-size:10px;font-weight:400;color:#1a73e8;margin-left:6px;padding:1px 6px;background:#e8f0fe;border-radius:3px">встроенный</span>' : '') +
            catBadge +
          '</div>' +
          '<div style="font-size:11px;color:var(--txt-3);margin-bottom:8px">' + escAttr(p.desc || '—') + '</div>' +
          '<div style="font-size:12px;color:var(--txt-2);background:var(--card-bg2,#1e2535);padding:8px 10px;border-radius:6px;border-left:2px solid ' + borderColor + ';white-space:pre-wrap">' +
            escAttr(p.text.slice(0, 120)) + (p.text.length > 120 ? '…' : '') +
          '</div>' +
        '</div>' +
        '<div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">' +
          '<button class="btn btn-sm btn-outline" data-rp-idx="' + origIdx + '" data-rp-action="apply">▶ Применить</button>' +
          (!isDefault ? '<button class="btn btn-sm btn-outline" data-rp-idx="' + origIdx + '" data-rp-action="edit">✏ Изменить</button>' : '') +
          (!isDefault ? '<button class="btn btn-sm" style="background:transparent;border:0.5px solid var(--red,#e53935);color:var(--red,#e53935)" data-rp-idx="' + origIdx + '" data-rp-action="del">✕</button>' : '') +
        '</div>' +
      '</div>' +
    '</div>';
  });
  html += '</div>';

  // Форма добавления / редактирования
  html += '<div style="border:0.5px solid var(--line-2);border-radius:10px;padding:12px;background:var(--card-bg)">' +
    '<div style="font-size:11px;font-weight:600;color:var(--txt-2);margin-bottom:8px" id="np-form-title">➕ Добавить промпт</div>' +
    '<input type="hidden" id="np-edit-id">' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:8px">' +
      '<input class="form-input" id="np-name" placeholder="Название">' +
      '<select class="form-select" id="np-category">' +
        '<option value="Общий">Общий</option>' +
        '<option value="Риски">Риски</option>' +
        '<option value="Сравнение">Сравнение</option>' +
        '<option value="Водоотлив">Водоотлив</option>' +
        '<option value="Рекомендации">Рекомендации</option>' +
        '<option value="Мои">Мои</option>' +
      '</select>' +
    '</div>' +
    '<input class="form-input" id="np-desc" placeholder="Описание" style="margin-bottom:8px">' +
    '<textarea class="form-textarea" id="np-text" rows="3" placeholder="Текст промпта..." style="margin-bottom:8px"></textarea>' +
    '<div style="display:flex;gap:8px">' +
      '<button class="btn btn-primary btn-sm" id="np-save-btn" onclick="saveNewPromptUI()">Сохранить</button>' +
      '<button class="btn btn-outline btn-sm" id="np-cancel-btn" onclick="cancelEditPrompt()" style="display:none">Отмена</button>' +
    '</div>' +
  '</div>';

  root.innerHTML = html;

  // Вешаем обработчики через делегирование на корень
  root.addEventListener('click', function(e) {
    var btn = e.target.closest('[data-rp-action]');
    if (!btn) return;
    var action = btn.dataset.rpAction;
    var idx = parseInt(btn.dataset.rpIdx, 10);
    var p = (window._rpPrompts || [])[idx];
    if (!p) return;

    if (action === 'apply') {
      applyPrompt(p.text);
      switchRpTab('settings');
    } else if (action === 'edit') {
      var nameEl = document.getElementById('np-name');
      var descEl = document.getElementById('np-desc');
      var textEl = document.getElementById('np-text');
      var editId = document.getElementById('np-edit-id');
      var titleEl = document.getElementById('np-form-title');
      var cancelBtn = document.getElementById('np-cancel-btn');
      var catSel = document.getElementById('np-category');
      if (nameEl) nameEl.value = p.name;
      if (descEl) descEl.value = p.desc || '';
      if (textEl) textEl.value = p.text;
      if (editId) editId.value = p.id;
      if (catSel && p.category) catSel.value = p.category;
      if (titleEl) titleEl.textContent = 'Редактировать промпт';
      if (cancelBtn) cancelBtn.style.display = '';
      nameEl && nameEl.scrollIntoView({ behavior: 'smooth', block: 'center' });
      nameEl && nameEl.focus();
    } else if (action === 'del') {
      if (!confirm('Удалить промпт "' + p.name + '"?')) return;
      deletePromptFromBank(p.id);
      fillPresetSelect();
      renderPromptsTab(activeCat);
      Toast.show('Промпт удалён', 'success');
    }
  });
}

function saveNewPromptUI() {
  var name   = ((document.getElementById('np-name')  ||{}).value || '').trim();
  var desc   = ((document.getElementById('np-desc')  ||{}).value || '').trim();
  var text   = ((document.getElementById('np-text')  ||{}).value || '').trim();
  var editId = ((document.getElementById('np-edit-id')||{}).value || '').trim();
  var cat    = getField('np-category') || 'Мои';
  if (!name || !text) { Toast.show('Заполните название и текст', 'warning'); return; }
  if (editId) {
    updatePromptInBank(editId, name, desc, text);
    Toast.show('Промпт обновлён', 'success');
  } else {
    addPromptToBank(name, desc, text, cat);
    Toast.show('Промпт сохранён', 'success');
  }
  fillPresetSelect();
  renderPromptsTab(window._rpActiveCat);
}

function cancelEditPrompt() {
  var nameEl   = document.getElementById('np-name');
  var descEl   = document.getElementById('np-desc');
  var textEl   = document.getElementById('np-text');
  var editIdEl = document.getElementById('np-edit-id');
  var titleEl  = document.getElementById('np-form-title');
  var cancelBtn= document.getElementById('np-cancel-btn');
  if (nameEl)   nameEl.value   = '';
  if (descEl)   descEl.value   = '';
  if (textEl)   textEl.value   = '';
  if (editIdEl) editIdEl.value = '';
  if (titleEl)  titleEl.textContent = '➕ Добавить промпт';
  if (cancelBtn) cancelBtn.style.display = 'none';
}

// ── Порядок разделов ─────────────────────────────────────
function getRpSectionsOrder() {
  try {
    var saved = JSON.parse(localStorage.getItem('rp-sections-order') || 'null');
    if (saved && Array.isArray(saved) && saved.length === RP_SECTIONS.length) return saved;
  } catch(e) {}
  return RP_SECTIONS.map(function(s){ return s.id; });
}
function saveRpSectionsOrder(order) {
  try { localStorage.setItem('rp-sections-order', JSON.stringify(order)); } catch(e) {}
}
function getSortedSections() {
  var order = getRpSectionsOrder();
  return order.map(function(id){ return RP_SECTIONS.find(function(s){ return s.id === id; }); }).filter(Boolean);
}

// ── Шаблоны ───────────────────────────────────────────────
function getRpTemplates() {
  try { return JSON.parse(localStorage.getItem('rp-templates') || '[]'); } catch(e) { return []; }
}
function saveRpTemplate(name) {
  if (!name) return;
  var tpls = getRpTemplates();
  var s = ReportState.settings;
  var order = getRpSectionsOrder();
  var checks = {};
  RP_SECTIONS.forEach(function(sec) {
    var el = document.getElementById(sec.chk);
    checks[sec.id] = el ? el.checked : sec.defOn;
  });
  tpls.unshift({ id: 't-' + Date.now(), name: name, createdAt: new Date().toISOString().slice(0,10),
    settings: { author: s.author, position: s.position, quarryName: s.quarryName, objectName: s.objectName, reportMode: s.reportMode },
    sections: order, checkboxes: checks });
  if (tpls.length > 20) tpls = tpls.slice(0, 20);
  try { localStorage.setItem('rp-templates', JSON.stringify(tpls)); } catch(e) {}
}
function loadRpTemplate(id) {
  var tpl = getRpTemplates().find(function(t){ return t.id === id; });
  if (!tpl) return;
  if (tpl.settings) {
    if (tpl.settings.author)     setField('rp-author',      tpl.settings.author);
    if (tpl.settings.position)   setField('rp-position',    tpl.settings.position);
    if (tpl.settings.quarryName) setField('rp-quarry-name', tpl.settings.quarryName);
    if (tpl.settings.objectName) setField('rp-object-name', tpl.settings.objectName);
    if (tpl.settings.reportMode) setReportMode(tpl.settings.reportMode);
  }
  if (tpl.sections) saveRpSectionsOrder(tpl.sections);
  if (tpl.checkboxes) {
    RP_SECTIONS.forEach(function(sec) {
      var el = document.getElementById(sec.chk);
      if (el && tpl.checkboxes[sec.id] !== undefined) el.checked = tpl.checkboxes[sec.id];
    });
  }
  renderSectionsList();
  saveReportSettings();
  Toast.show('Шаблон «' + escHTML(tpl.name) + '» загружен', 'success');
}
function deleteRpTemplate(id) {
  var tpls = getRpTemplates().filter(function(t){ return t.id !== id; });
  try { localStorage.setItem('rp-templates', JSON.stringify(tpls)); } catch(e) {}
  renderRpTemplatesList();
}

// ── История отчётов ───────────────────────────────────────
function getRpHistory() {
  try { return JSON.parse(localStorage.getItem('rp-report-history') || '[]'); } catch(e) { return []; }
}
function addRpHistory(s) {
  var hist = getRpHistory();
  var secs = RP_SECTIONS.filter(function(sec){ var el = document.getElementById(sec.chk); return el && el.checked; }).map(function(sec){ return sec.id; });
  hist.unshift({ id: 'h-' + Date.now(), date: s.dateReport || new Date().toISOString().slice(0,10),
    quarryName: s.quarryName || '—', dateA: s.dateA, dateB: s.dateB, mode: s.reportMode, version: s.reportVersion, sections: secs });
  if (hist.length > 10) hist = hist.slice(0, 10);
  try { localStorage.setItem('rp-report-history', JSON.stringify(hist)); } catch(e) {}
}

// ── Быстрые кнопки выбора карьера ────────────────────────
function _rpQuarryBtns() {
  var quarries = (window.AppState && AppState.quarries) || [];
  if (!quarries.length) return '';
  return quarries.slice(0, 4).map(function(q) {
    return '<button type="button" onclick="rpSelectQuarry(' + JSON.stringify(q.name) + ')" ' +
      'style="padding:3px 10px;border-radius:6px;border:1px solid rgba(255,255,255,.15);' +
      'background:rgba(255,255,255,.06);color:var(--txt-2);font-size:11px;cursor:pointer;white-space:nowrap">' +
      escHTML(q.name) + '</button>';
  }).join('');
}

function rpSelectQuarry(name) {
  var inp = document.getElementById('rp-quarry-name');
  if (inp) { inp.value = name; }
  /* Переключаем activeQuarry чтобы карта и данные подтянулись */
  if (window.AppState && typeof switchQuarry === 'function') {
    switchQuarry(name, true /* suppressReload */);
  }
  saveReportSettings();
}

// ── Переключение шагов ────────────────────────────────────
function switchStep(n) {
  ReportState.currentStep = n;
  for (var i = 1; i <= 5; i++) {
    var panel = document.getElementById('rp-panel-' + i);
    var btn   = document.getElementById('rp-stepbtn-' + i);
    if (panel) panel.style.display = (i === n) ? 'block' : 'none';
    if (btn) {
      btn.classList.toggle('rp-step--active', i === n);
      btn.classList.toggle('rp-step--done',   i < n);
    }
  }
  if (n === 5) renderRpStep5();
  if (n === 2) renderSectionsList();
}

function renderRpFilters() {
  var pts = ReportState.allPoints || [];
  // Collect unique domains and horizons
  var domains = [], domSet = {};
  var horizons = [], horzSet = {};
  pts.forEach(function(p) {
    var d = p.domain || p.domen || '—';
    if (!domSet[d]) { domSet[d] = 1; domains.push(d); }
    var h = p.horizon || p.gorizont || '';
    if (h && !horzSet[h]) { horzSet[h] = 1; horizons.push(h); }
  });
  domains.sort(); horizons.sort();

  var sel = ReportState.settings.filterDomains || [];
  var selH = ReportState.settings.filterHorizons || [];

  function makeChk(val, selArr, key) {
    var checked = selArr.length === 0 || selArr.indexOf(val) >= 0;
    return '<label style="display:flex;align-items:center;gap:6px;font-size:12px;color:var(--txt-1);cursor:pointer;white-space:nowrap">' +
      '<input type="checkbox" data-filter-key="' + key + '" data-filter-val="' + escAttr(val) + '"' + (checked ? ' checked' : '') +
        ' onchange="rpFilterChange(this)" style="accent-color:var(--blue)">' + escHTML(val) + '</label>';
  }

  var dEl = document.getElementById('rp-filter-domains');
  var hEl = document.getElementById('rp-filter-horizons');
  if (dEl) {
    if (!domains.length) {
      dEl.innerHTML = '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:4px">Нет данных</div>';
    } else {
      dEl.innerHTML = domains.map(function(d){ return makeChk(d, sel, 'domain'); }).join('');
    }
  }
  if (hEl) {
    if (!horizons.length) {
      hEl.innerHTML = '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:4px">Нет горизонтов</div>';
    } else {
      hEl.innerHTML = horizons.map(function(h){ return makeChk(h, selH, 'horizon'); }).join('');
    }
  }
}

function rpFilterChange(el) {
  var key = el.dataset.filterKey;
  var field = key === 'domain' ? 'filterDomains' : 'filterHorizons';
  var container = el.closest('[id^="rp-filter-"]');
  // Collect all checked values in this container
  var checked = [];
  container.querySelectorAll('input[type=checkbox]').forEach(function(c) {
    if (c.checked) checked.push(c.dataset.filterVal);
  });
  // If all checked — store as [] (means "all")
  var total = container.querySelectorAll('input[type=checkbox]').length;
  ReportState.settings[field] = (checked.length === total) ? [] : checked;
  saveReportSettings();
}

// ── Список разделов (drag-and-drop) ──────────────────────
function renderSectionsList() {
  var container = document.getElementById('rp-sections-list');
  if (!container) return;
  var sorted = getSortedSections();
  container.innerHTML = sorted.map(function(sec) {
    var el = document.getElementById(sec.chk);
    var checked = el ? el.checked : sec.defOn;
    return '<div class="rp-sec-card" draggable="true" data-sec-id="' + sec.id + '" ' +
      'ondragstart="rpSecDragStart(event)" ondragover="rpSecDragOver(event)" ' +
      'ondrop="rpSecDrop(event)" ondragend="rpSecDragEnd(event)">' +
      '<span class="rp-sec-grip">⠿</span>' +
      '<span class="rp-sec-icon">' + sec.icon + '</span>' +
      '<span class="rp-sec-label">' + sec.label + '</span>' +
      '<input type="checkbox" id="' + sec.chk + '"' + (checked ? ' checked' : '') + ' onchange="saveReportSettings();updateRpPreviewPanel()">' +
    '</div>';
  }).join('');
  updateRpPreviewPanel();
}

// Drag-and-drop
var _rpDragSrcId = null;
function rpSecDragStart(e) {
  _rpDragSrcId = e.currentTarget.dataset.secId;
  e.currentTarget.style.opacity = '0.4';
  e.dataTransfer.effectAllowed = 'move';
}
function rpSecDragOver(e) {
  e.preventDefault();
  e.dataTransfer.dropEffect = 'move';
  document.querySelectorAll('.rp-sec-card').forEach(function(c){ c.classList.remove('rp-sec-card--over'); });
  e.currentTarget.classList.add('rp-sec-card--over');
}
function rpSecDrop(e) {
  e.stopPropagation();
  var targetId = e.currentTarget.dataset.secId;
  if (_rpDragSrcId && _rpDragSrcId !== targetId) {
    var order = getRpSectionsOrder();
    var from = order.indexOf(_rpDragSrcId);
    var to   = order.indexOf(targetId);
    if (from >= 0 && to >= 0) {
      order.splice(from, 1);
      order.splice(to, 0, _rpDragSrcId);
      saveRpSectionsOrder(order);
      renderSectionsList();
    }
  }
  return false;
}
function rpSecDragEnd(e) {
  _rpDragSrcId = null;
  document.querySelectorAll('.rp-sec-card').forEach(function(c){
    c.style.opacity = '';
    c.classList.remove('rp-sec-card--over');
  });
}

// ── Правая панель превью ──────────────────────────────────
function updateRpPreviewPanel() {
  var listEl = document.getElementById('rp-preview-sections');
  if (!listEl) return;
  var sorted = getSortedSections();
  listEl.innerHTML = sorted.map(function(sec) {
    var el = document.getElementById(sec.chk);
    var on = el ? el.checked : sec.defOn;
    return '<div class="rp-preview-sec' + (on ? ' rp-preview-sec--on' : '') + '">' +
      '<span class="rp-preview-dot' + (on ? ' rp-preview-dot--on' : '') + '"></span>' +
      '<span>' + sec.icon + ' ' + sec.label + '</span>' +
    '</div>';
  }).join('');
  var cnt = sorted.filter(function(sec){ var el = document.getElementById(sec.chk); return el && el.checked; }).length;
  var pageEl = document.getElementById('rp-preview-pages');
  if (pageEl) pageEl.textContent = cnt + ' разд. · ~' + (cnt * 2 + 3) + ' стр.';
}

// ── Шаг 5: шаблоны и история ─────────────────────────────
function renderRpTemplatesList() {
  var el = document.getElementById('rp-templates-list');
  if (!el) return;
  var tpls = getRpTemplates();
  if (!tpls.length) {
    el.innerHTML = '<div style="font-size:12px;color:var(--txt-3);text-align:center;padding:8px">Нет сохранённых шаблонов</div>';
    return;
  }
  el.innerHTML = tpls.map(function(t) {
    return '<div class="rp-tpl-item">' +
      '<div style="flex:1;min-width:0"><div class="rp-tpl-name">' + escHTML(t.name) + '</div>' +
      '<div class="rp-tpl-meta">' + fmtDate(t.createdAt) + '</div></div>' +
      '<button class="btn btn-sm btn-outline" onclick="loadRpTemplate(\'' + t.id + '\')">Загрузить</button>' +
      '<button class="btn btn-sm" style="background:transparent;border:none;color:var(--txt-3);cursor:pointer;padding:4px 6px" ' +
        'onclick="deleteRpTemplate(\'' + t.id + '\')">✕</button>' +
    '</div>';
  }).join('');
}

function renderRpStep5() {
  var histEl = document.getElementById('rp-history-list');
  if (histEl) {
    var hist = getRpHistory();
    if (!hist.length) {
      histEl.innerHTML = '<div style="font-size:12px;color:var(--txt-3);text-align:center;padding:12px">История пуста — отчёты появятся здесь после генерации</div>';
    } else {
      histEl.innerHTML = hist.map(function(h) {
        var dates = fmtDate(h.dateA) + (h.mode !== 'single' ? ' → ' + fmtDate(h.dateB) : '');
        return '<div class="rp-hist-item">' +
          '<div style="font-size:13px;font-weight:600;color:var(--txt-1)">' + escHTML(h.quarryName) + ' · v' + h.version + '</div>' +
          '<div style="font-size:11px;color:var(--txt-3);margin-top:2px">' + dates + ' · составлен ' + fmtDate(h.date) + '</div>' +
        '</div>';
      }).join('');
    }
  }
  renderRpTemplatesList();
}

function switchRpTab(tab) {
  var panelPr = document.getElementById('rp-tab-prompts');
  var panelSt = document.getElementById('rp-tab-settings');
  if (panelPr) panelPr.style.display = (tab === 'prompts')  ? '' : 'none';
  if (panelSt) panelSt.style.display = (tab === 'settings') ? '' : 'none';
  var btnPr = document.getElementById('rp-tabbtn-prompts');
  var btnSt = document.getElementById('rp-tabbtn-settings');
  if (btnPr) btnPr.classList.toggle('active', tab === 'prompts');
  if (btnSt) btnSt.classList.toggle('active', tab === 'settings');
  if (tab === 'prompts') renderPromptsTab();
}

function buildSettingsUI() {
  return '<div class="rp-constructor">' +

  // ═══ LEFT: STEPS NAV ════════════════════════════════════
  '<nav class="rp-steps-nav">' +
    '<div class="rp-steps-nav-title">ЭТАПЫ</div>' +
    _rpStepBtn(1, 'Период и объект', 'Режим, даты, автор') +
    _rpStepBtn(2, 'Содержание',      'Разделы и порядок') +
    _rpStepBtn(3, 'Стиль',           'Цвет, оформление') +
    _rpStepBtn(4, 'ИИ-анализ',       'Промпты, заключение') +
    _rpStepBtn(5, 'Генерация',        'Шаблоны, история') +
    '<div class="rp-steps-nav-footer">' +
      '<div id="rp-steps-author-info" style="font-size:11px;color:var(--txt-3)"></div>' +
    '</div>' +
  '</nav>' +

  // ═══ CENTER: STEP PANELS ════════════════════════════════
  '<div class="rp-step-panels">' +

  // ─── Panel 1: Период ────────────────────────────────────
  '<div id="rp-panel-1" class="rp-step-panel">' +
    '<div class="rp-panel-title">Период и объект</div>' +
    '<div class="rp-panel-sub">Укажите карьер, составителя и даты мониторинга</div>' +

    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">Объект и составитель</div>' +
    '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">' +
        '<div><label class="rp-lbl">Карьер</label>' +
          '<div style="display:flex;gap:6px;margin-top:4px;align-items:center">' +
            '<div style="display:flex;gap:4px" id="rp-quarry-btns">' +
              _rpQuarryBtns() +
            '</div>' +
            '<input class="form-input" id="rp-quarry-name" placeholder="ЮРГ" style="flex:1;min-width:0">' +
          '</div>' +
        '</div>' +
        '<div><label class="rp-lbl">Объект / участок</label><input class="form-input" id="rp-object-name" placeholder="Пулково-42" style="margin-top:4px"></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end">' +
        '<div><label class="rp-lbl">ФИО составителя</label><input class="form-input" id="rp-author" placeholder="Юкин Р.А." style="margin-top:4px"></div>' +
        '<div><label class="rp-lbl">Должность</label><input class="form-input" id="rp-position" placeholder="Гидрогеолог" style="margin-top:4px"></div>' +
        '<div><label class="rp-lbl">Дата составления</label><input class="form-input" id="rp-date" type="date" style="margin-top:4px;width:148px"></div>' +
      '</div>' +
    '</div>' +

    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">Тип и период отчёта</div>' +
    '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:flex;gap:8px;margin-bottom:12px">' +
        '<button id="rp-mode-single"  class="btn btn-primary" onclick="setReportMode(\'single\')"  style="flex:1;font-size:13px">📅 Один срез</button>' +
        '<button id="rp-mode-compare" class="btn btn-outline" onclick="setReportMode(\'compare\')" style="flex:1;font-size:13px">📊 Сравнение</button>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">' +
        '<div><label id="rp-label-a" class="rp-lbl">Дата мониторинга</label>' +
          '<select class="form-select" id="rp-date-a" onchange="onReportDateChange()" style="margin-top:4px"></select></div>' +
        '<div id="rp-period-b-block" style="display:none">' +
          '<label class="rp-lbl">Период Б (текущий)</label>' +
          '<select class="form-select" id="rp-date-b" onchange="onReportDateChange()" style="margin-top:4px"></select>' +
        '</div>' +
      '</div>' +
      '<div id="rp-dates-status" style="font-size:11px;color:var(--txt-3);margin-top:6px"></div>' +
    '</div>' +

    '<div id="rp-data-status" style="display:none;margin-bottom:12px">' +
      '<div class="card"><div id="rp-data-summary" style="font-size:12px;color:var(--txt-2)"></div></div>' +
    '</div>' +

    '<button class="btn btn-outline" id="rp-load-btn-step" onclick="loadReportData()" style="white-space:nowrap;margin-bottom:16px">📥 Загрузить данные</button>' +

    '<div class="rp-panel-nav">' +
      '<div></div>' +
      '<button class="btn btn-primary" onclick="switchStep(2)">Содержание →</button>' +
    '</div>' +
  '</div>' +

  // ─── Panel 2: Содержание ─────────────────────────────────
  '<div id="rp-panel-2" class="rp-step-panel" style="display:none">' +
    '<div class="rp-panel-title">Содержание отчёта</div>' +
    '<div class="rp-panel-sub">Включите нужные разделы и перетащите для изменения порядка</div>' +
    '<div id="rp-sections-list" class="rp-sections-list"></div>' +
    '<div style="margin-top:16px;border-top:1px solid var(--line-2);padding-top:14px">' +
      '<div style="font-size:11px;font-weight:700;color:var(--txt-2);margin-bottom:10px">🔽 Фильтры (необязательно)</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div>' +
          '<div style="font-size:11px;color:var(--txt-3);margin-bottom:6px">Домены (пусто = все)</div>' +
          '<div id="rp-filter-domains" style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;padding:6px;background:var(--card-bg2);border-radius:6px;border:1px solid var(--line-2)">' +
            '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:4px">Загрузите данные</div>' +
          '</div>' +
        '</div>' +
        '<div>' +
          '<div style="font-size:11px;color:var(--txt-3);margin-bottom:6px">Горизонты (пусто = все)</div>' +
          '<div id="rp-filter-horizons" style="display:flex;flex-direction:column;gap:4px;max-height:120px;overflow-y:auto;padding:6px;background:var(--card-bg2);border-radius:6px;border:1px solid var(--line-2)">' +
            '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:4px">Загрузите данные</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:10px;display:flex;gap:8px">' +
      '<button class="btn btn-outline btn-sm" onclick="saveRpSectionsOrder(RP_SECTIONS.map(function(s){return s.id}));renderSectionsList()">↺ Исходный порядок</button>' +
    '</div>' +
    '<div class="rp-panel-nav">' +
      '<button class="btn btn-outline" onclick="switchStep(1)">← Период</button>' +
      '<button class="btn btn-primary" onclick="switchStep(3)">Стиль →</button>' +
    '</div>' +
  '</div>' +

  // ─── Panel 3: Стиль ──────────────────────────────────────
  '<div id="rp-panel-3" class="rp-step-panel" style="display:none">' +
    '<div class="rp-panel-title">Стиль отчёта</div>' +
    '<div class="rp-panel-sub">Макет и цветовая схема определяют оформление отчёта</div>' +
    '<div style="margin-bottom:18px">' +
      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Макет отчёта</div>' +
      '<div class="rp-layout-grid">' +
        _rpLayoutCard('a',  '📄', 'A — Технический',   'Тёмная шапка, инженерный стиль, sans-serif') +
        _rpLayoutCard('ab', '🔀', 'A+B — Гибрид',      'Тёмная шапка + цветные KPI-карточки') +
        _rpLayoutCard('b',  '📊', 'B — Дашборд',        'Светлый фон, KPI-карточки с иконками') +
        _rpLayoutCard('c',  '📋', 'C — Протокол',       'Бланк, serif-шрифт, ГОСТ-стиль') +
      '</div>' +
    '</div>' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Цветовая схема</div>' +
    '<div class="rp-theme-grid">' +
      _rpThemeCard('blue',   '🔵', 'Синяя',     '#1e3a8a,#3b82f6', true) +
      _rpThemeCard('green',  '🟢', 'Зелёная',   '#14532d,#16a34a', false) +
      _rpThemeCard('mono',   '⚫', 'Монохром',  '#1e293b,#475569', false) +
      _rpThemeCard('red',    '🔴', 'Красная',   '#7c2d12,#ea580c', false) +
      _rpThemeCard('violet', '🟣', 'Фиолетовая','#4c1d95,#7c3aed', false) +
    '</div>' +
    '<div style="margin-top:18px">' +
      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Ориентация страницы</div>' +
      '<div style="display:flex;gap:10px">' +
        '<button id="rp-orient-portrait"  onclick="rpSetOrientation(\'portrait\')"  class="btn btn-sm" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px">📄 Книжная</button>' +
        '<button id="rp-orient-landscape" onclick="rpSetOrientation(\'landscape\')" class="btn btn-sm" style="flex:1;display:flex;align-items:center;justify-content:center;gap:6px">🖼 Альбомная</button>' +
      '</div>' +
    '</div>' +
    '<div style="margin-top:20px">' +
      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Логотип на титульной странице</div>' +
      '<div class="card" style="margin-bottom:14px">' +
        '<div style="display:flex;align-items:center;gap:14px">' +
          '<div id="rp-logo-preview" style="width:56px;height:56px;border-radius:50%;background:var(--card-bg2);border:2px dashed var(--line-2);display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0;overflow:hidden">🏭</div>' +
          '<div style="flex:1">' +
            '<label class="btn btn-outline btn-sm" style="cursor:pointer;display:inline-block">' +
              '📁 Выбрать файл (PNG, SVG)' +
              '<input type="file" id="rp-logo-input" accept="image/*" style="display:none" onchange="rpLogoChange(this)">' +
            '</label>' +
            '<div style="font-size:11px;color:var(--txt-3);margin-top:6px">Рекомендуется квадратный PNG, мин. 100×100 px</div>' +
            '<button class="btn btn-sm" id="rp-logo-clear-btn" style="display:none;margin-top:6px;font-size:11px;background:transparent;border:none;color:var(--txt-3);cursor:pointer;padding:0" onclick="rpLogoClear()">✕ Удалить логотип</button>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Водяной знак</div>' +
      '<div class="card" style="margin-bottom:14px">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;align-items:end">' +
          '<div><label class="rp-lbl">Гриф документа</label>' +
            '<select class="form-select" id="rp-watermark" style="margin-top:4px" onchange="rpWatermarkChange(this)">' +
              '<option value="">Без водяного знака</option>' +
              '<option value="ДСП">ДСП (Для служебного пользования)</option>' +
              '<option value="Внутренний">Внутренний</option>' +
              '<option value="Для заказчика">Для заказчика</option>' +
              '<option value="Черновик">Черновик</option>' +
              '<option value="custom">Свой текст...</option>' +
            '</select>' +
          '</div>' +
          '<div id="rp-watermark-custom-wrap" style="display:none">' +
            '<label class="rp-lbl">Свой текст</label>' +
            '<input class="form-input" id="rp-watermark-custom" placeholder="Конфиденциально" style="margin-top:4px" oninput="saveReportSettings()">' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:10px">Блок подписи</div>' +
      '<div class="card">' +
        '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:10px">' +
          '<input type="checkbox" id="rp-inc-signature" onchange="saveReportSettings()"> ' +
          'Добавить блок подписи на титульную страницу' +
        '</label>' +
        '<div><label class="rp-lbl">ФИО утверждающего (необязательно)</label>' +
          '<input class="form-input" id="rp-approver-name" placeholder="Гл. геолог Петров А.С." style="margin-top:4px" oninput="saveReportSettings()">' +
        '</div>' +
      '</div>' +
    '</div>' +
    '<div class="rp-panel-nav">' +
      '<button class="btn btn-outline" onclick="switchStep(2)">← Содержание</button>' +
      '<button class="btn btn-primary" onclick="switchStep(4)">ИИ-анализ →</button>' +
    '</div>' +
  '</div>' +

  // ─── Panel 4: ИИ-анализ ──────────────────────────────────
  '<div id="rp-panel-4" class="rp-step-panel" style="display:none">' +
    '<div class="rp-panel-title">ИИ-анализ (Gemini)</div>' +

    // ── Toggle-ряд ──
    '<div class="rp-ai-toggle-row">' +
      '<div class="rp-ai-toggle-info">' +
        '<span class="rp-ai-toggle-icon">🤖</span>' +
        '<div>' +
          '<div class="rp-ai-toggle-label">Автоматический AI-анализ</div>' +
          '<div class="rp-ai-toggle-sub">Включает генерацию текстовых выводов при формировании отчёта</div>' +
        '</div>' +
      '</div>' +
      '<label class="rp-toggle">' +
        '<input type="checkbox" id="rp-inc-ai-cb" checked onchange="rpAIToggle(this)">' +
        '<span class="rp-toggle-pill"></span>' +
      '</label>' +
    '</div>' +

    '<div id="rp-ai-settings-body">' +
    '<div class="card" style="margin-bottom:14px">' +
      '<label class="rp-lbl">Google API ключ</label>' +
      '<input class="form-input" id="rp-apikey" type="password" placeholder="AIza..." ' +
        'style="margin-top:4px;font-family:monospace;font-size:12px">' +
      '<div style="font-size:10px;color:var(--txt-3);margin-top:3px">Ключ хранится только в браузере</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div>' +
          '<label class="rp-lbl">Модель Gemini</label>' +
          '<select class="form-select" id="rp-ai-model" style="margin-top:4px" onchange="saveReportSettings()">' +
            '<option value="gemini-1.5-flash">Flash 1.5 — быстро (рекомендуется)</option>' +
            '<option value="gemini-2.0-flash">Flash 2.0 — новее</option>' +
            '<option value="gemini-1.5-pro">Pro 1.5 — глубокий анализ</option>' +
          '</select>' +
        '</div>' +
        '<div>' +
          '<label class="rp-lbl">Тон анализа</label>' +
          '<select class="form-select" id="rp-ai-tone" style="margin-top:4px" onchange="saveReportSettings()">' +
            '<option value="official">Официальный технический</option>' +
            '<option value="brief">Краткий (2-3 абзаца)</option>' +
            '<option value="detailed">Детальный с рекомендациями</option>' +
            '<option value="executive">Для руководства (нетехнический)</option>' +
          '</select>' +
        '</div>' +
      '</div>' +
      '<div style="margin-top:10px;display:flex;align-items:center;justify-content:space-between">' +
        '<div style="font-size:11px;color:var(--txt-3)" id="rp-ai-cache-info">Кэш: пусто</div>' +
        '<button class="btn btn-sm" style="font-size:11px;padding:4px 10px;background:transparent;border:1px solid var(--line-2);color:var(--txt-3)" onclick="clearAICache()">✕ Очистить кэш</button>' +
      '</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:flex;gap:4px;border-bottom:1px solid var(--line-2);margin-bottom:12px">' +
        '<button id="rp-tabbtn-prompts" class="btn btn-sm active" onclick="switchRpTab(\'prompts\')" ' +
          'style="border-radius:8px 8px 0 0;border-bottom:none;padding:7px 16px">🗒 Банк промптов</button>' +
        '<button id="rp-tabbtn-settings" onclick="switchRpTab(\'settings\')" ' +
          'style="border-radius:8px 8px 0 0;border:0.5px solid var(--line-2);border-bottom:none;padding:7px 16px;background:transparent;cursor:pointer;color:var(--txt-2);font-size:13px">✏ Свой промпт</button>' +
      '</div>' +
      '<div id="rp-tab-prompts"></div>' +
      '<div id="rp-tab-settings" style="display:none">' +
        '<div style="display:flex;gap:8px;align-items:flex-end;margin-bottom:8px">' +
          '<div style="flex:1">' +
            '<label class="rp-lbl">Готовый промпт из банка</label>' +
            '<div style="position:relative;margin-top:4px">' +
              '<select class="form-select" id="rp-preset-select" style="appearance:none;-webkit-appearance:none;padding-right:32px" onchange="onPresetChange(this)">' +
                '<option value="">— выбрать из банка —</option>' +
              '</select>' +
              '<span style="position:absolute;right:10px;top:50%;transform:translateY(-50%);pointer-events:none;color:var(--txt-3);font-size:12px">▼</span>' +
            '</div>' +
          '</div>' +
        '</div>' +
        '<label class="rp-lbl">Свой промпт (инструкция для AI)</label>' +
        '<textarea class="form-textarea" id="rp-custom-prompt" rows="4" ' +
          'placeholder="Составь краткий вывод по гидрогеологической обстановке..." ' +
          'style="margin-top:4px;font-size:12px" oninput="saveReportSettings()"></textarea>' +
        '<div style="font-size:10px;color:var(--txt-3);margin-top:3px">AI получает: Q, статусы, горизонты, домены, борт, цвет воды, наблюдения по топ-10 точкам</div>' +
      '</div>' +
    '</div>' +

    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">Предпросмотр AI-текстов</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:10px">' +
        '<button class="btn btn-outline btn-sm" onclick="preGenerateAI()" id="rp-pre-ai-btn">✨ Сгенерировать тексты</button>' +
        '<span style="font-size:11px;color:var(--txt-3)">Результаты можно отредактировать перед включением в отчёт</span>' +
      '</div>' +
      '<div id="rp-ai-preview-blocks" style="display:flex;flex-direction:column;gap:10px">' +
        '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:8px">Нажмите «Сгенерировать тексты» для предпросмотра AI-анализа</div>' +
      '</div>' +
    '</div>' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">Заключение и рекомендации</div>' +
    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:flex;gap:8px;align-items:center;margin-bottom:8px">' +
        '<button class="btn btn-outline" id="rp-ai-concl-btn" onclick="generateAIConclusion()" style="white-space:nowrap">✨ Сгенерировать через AI</button>' +
        '<span style="font-size:12px;color:var(--txt-3)">или введите вручную ↓</span>' +
      '</div>' +
      '<textarea class="form-textarea" id="rp-conclusions" rows="4" placeholder="Введите заключение и рекомендации..." style="font-size:12px"></textarea>' +
    '</div>' +
    '</div>' + // end rp-ai-settings-body

    '<div class="rp-panel-nav">' +
      '<button class="btn btn-outline" onclick="switchStep(3)">← Стиль</button>' +
      '<button class="btn btn-primary" onclick="switchStep(5)">Генерация →</button>' +
    '</div>' +
  '</div>' +

  // ─── Panel 5: Генерация ──────────────────────────────────
  '<div id="rp-panel-5" class="rp-step-panel" style="display:none">' +
    '<div class="rp-panel-title">Генерация отчёта</div>' +
    '<div class="rp-panel-sub">Проверьте настройки и запустите формирование</div>' +

    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">Шаблоны</div>' +
    '<div class="card" style="margin-bottom:16px">' +
      '<div style="display:flex;gap:8px;margin-bottom:10px">' +
        '<input class="form-input" id="rp-tpl-name" placeholder="Название шаблона..." style="flex:1">' +
        '<button class="btn btn-outline" onclick="var n=getField(\'rp-tpl-name\');if(n){saveRpTemplate(n);Toast.show(\'Шаблон сохранён\',\'success\');renderRpTemplatesList();setField(\'rp-tpl-name\',\'\');}">Сохранить</button>' +
      '</div>' +
      '<div id="rp-templates-list"></div>' +
    '</div>' +

    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--txt-3);margin-bottom:8px">История отчётов</div>' +
    '<div class="card" style="margin-bottom:20px">' +
      '<div id="rp-history-list"><div style="font-size:12px;color:var(--txt-3);text-align:center;padding:12px">История пуста</div></div>' +
    '</div>' +

    '<div class="rp-panel-nav">' +
      '<button class="btn btn-outline" onclick="switchStep(4)">← ИИ-анализ</button>' +
      '<div></div>' +
    '</div>' +
  '</div>' +

  '</div>' +

  // ═══ RIGHT: PREVIEW PANEL ══════════════════════════════
  '<aside class="rp-preview-panel">' +
    '<div class="rp-preview-title">ПРЕДПРОСМОТР</div>' +
    '<div class="rp-mini-report">' +
      '<div class="rp-mini-page">' +
        '<div class="rp-mini-hdr"></div>' +
        '<div class="rp-mini-kpis"><div></div><div></div><div></div></div>' +
        '<div class="rp-mini-line" style="width:80%"></div>' +
        '<div class="rp-mini-line" style="width:60%"></div>' +
        '<div class="rp-mini-block"></div>' +
        '<div class="rp-mini-line" style="width:70%"></div>' +
      '</div>' +
      '<div id="rp-preview-pages" style="font-size:11px;color:var(--txt-3);text-align:center;margin-top:8px">— разделов не выбрано —</div>' +
    '</div>' +

    '<div class="rp-preview-title" style="margin-top:4px">РАЗДЕЛЫ</div>' +
    '<div id="rp-preview-sections" class="rp-preview-sections"></div>' +

    '<div style="margin-top:auto;display:flex;flex-direction:column;gap:8px;padding-top:12px">' +
      '<button class="btn btn-outline" id="rp-load-btn" onclick="loadReportData()" style="white-space:nowrap;font-size:13px">📥 Загрузить данные</button>' +
      '<button class="btn btn-primary" id="rp-generate-btn" onclick="generateReport()" ' +
        'style="opacity:.5;pointer-events:none;font-size:13px;background:linear-gradient(135deg,#2563eb,#7c3aed)">⚡ Сформировать</button>' +
    '</div>' +
  '</aside>' +

  '</div>';
}

// Helpers for buildSettingsUI
function _rpStepBtn(n, label, sub) {
  return '<div id="rp-stepbtn-' + n + '" class="rp-step' + (n === 1 ? ' rp-step--active' : '') + '" onclick="switchStep(' + n + ')">' +
    '<div class="rp-step-num">' + n + '</div>' +
    '<div><div class="rp-step-lbl">' + label + '</div><div class="rp-step-sub">' + sub + '</div></div>' +
  '</div>';
}
function _rpThemeCard(id, ico, name, colors, active) {
  var grad = 'linear-gradient(135deg,' + colors + ')';
  return '<div class="rp-theme-card' + (active ? ' rp-theme-card--active' : '') + '" onclick="rpSelectTheme(\'' + id + '\')" data-theme="' + id + '">' +
    '<div class="rp-theme-swatch" style="background:' + grad + '">' + ico + '</div>' +
    '<div class="rp-theme-name">' + name + '</div>' +
  '</div>';
}
function _rpLayoutCard(id, ico, name, sub) {
  var active = (ReportState.settings.reportLayout || 'a') === id;
  return '<div class="rp-layout-card' + (active ? ' rp-layout-card--active' : '') + '" ' +
    'data-layout="' + id + '" onclick="rpSelectLayout(\'' + id + '\')">' +
    '<div class="rp-layout-icon">' + ico + '</div>' +
    '<div class="rp-layout-name">' + name + '</div>' +
    '<div class="rp-layout-sub">' + sub + '</div>' +
  '</div>';
}
function rpLogoChange(input) {
  var file = input.files && input.files[0];
  if (!file) return;
  var reader = new FileReader();
  reader.onload = function(e) {
    var b64 = e.target.result;
    localStorage.setItem('rp-logo-base64', b64);
    rpLogoUpdatePreview(b64);
  };
  reader.readAsDataURL(file);
}
function rpLogoClear() {
  localStorage.removeItem('rp-logo-base64');
  rpLogoUpdatePreview(null);
}
function rpLogoUpdatePreview(b64) {
  var prev = document.getElementById('rp-logo-preview');
  var clearBtn = document.getElementById('rp-logo-clear-btn');
  if (prev) {
    if (b64) {
      prev.innerHTML = '<img src="' + b64 + '" style="width:56px;height:56px;object-fit:cover;border-radius:50%">';
    } else {
      prev.innerHTML = '🏭';
    }
  }
  if (clearBtn) clearBtn.style.display = b64 ? '' : 'none';
}
function rpWatermarkChange(sel) {
  var wrap = document.getElementById('rp-watermark-custom-wrap');
  if (wrap) wrap.style.display = (sel.value === 'custom') ? '' : 'none';
  saveReportSettings();
}
function rpSelectTheme(id) {
  document.querySelectorAll('.rp-theme-card').forEach(function(c){ c.classList.toggle('rp-theme-card--active', c.dataset.theme === id); });
  ReportState.settings.reportTheme = id;
  saveReportSettings();
}
function rpAIToggle(cb) {
  var body = document.getElementById('rp-ai-settings-body');
  if (body) body.style.display = cb.checked ? '' : 'none';
  var hidden = document.getElementById('rp-inc-ai');
  if (hidden) hidden.checked = cb.checked;
  saveReportSettings();
}

function rpSetOrientation(orient) {
  ReportState.settings.orientation = orient;
  var isLandscape = orient === 'landscape';
  var pb = document.getElementById('rp-orient-portrait');
  var lb = document.getElementById('rp-orient-landscape');
  if (pb) { pb.classList.toggle('btn-primary', !isLandscape); pb.classList.toggle('btn-outline', isLandscape); }
  if (lb) { lb.classList.toggle('btn-primary',  isLandscape); lb.classList.toggle('btn-outline', !isLandscape); }
  saveReportSettings();
}

function rpSelectLayout(id) {
  ReportState.settings.reportLayout = id;
  document.querySelectorAll('.rp-layout-card').forEach(function(c){
    c.classList.toggle('rp-layout-card--active', c.dataset.layout === id);
  });
  saveReportSettings();
}

function setReportMode(mode) {
  ReportState.settings.reportMode = mode;
  var btnS    = document.getElementById('rp-mode-single');
  var btnC    = document.getElementById('rp-mode-compare');
  var blockB  = document.getElementById('rp-period-b-block');
  var labelA  = document.getElementById('rp-label-a');
  var cmpChk  = document.getElementById('rp-inc-compare');

  var isSingle = (mode === 'single');
  if (btnS) { btnS.className = 'btn btn-primary'; btnS.style.flex='1'; btnS.style.fontSize='13px'; }
  if (btnC) { btnC.className = 'btn btn-outline'; btnC.style.flex='1'; btnC.style.fontSize='13px'; }
  if (!isSingle) {
    if (btnS) btnS.className = 'btn btn-outline'; btnS && (btnS.style.flex='1');
    if (btnC) btnC.className = 'btn btn-primary'; btnC && (btnC.style.flex='1');
  }
  if (blockB) blockB.style.display = isSingle ? 'none' : '';
  if (labelA) labelA.textContent   = isSingle ? 'Дата мониторинга' : 'Период А (базовый)';
  if (cmpChk) { cmpChk.checked = !isSingle; cmpChk.disabled = isSingle; }

  // Обновляем выпадающий список готовых промптов
  fillPresetSelect();
  saveReportSettings();
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
    renderRpFilters();
    return loadDitchesHistory().then(function() { return loadWellsForReport(); });
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

function loadWellsForReport() {
  // Temporarily set active quarry from report settings so Api.getWells() returns the right data
  var rpQuarry = getField('rp-quarry-name') || (ReportState.settings && ReportState.settings.quarryName) || '';
  var prevQuarry = window.AppState ? AppState.activeQuarry : '';
  if (rpQuarry && window.AppState) AppState.activeQuarry = rpQuarry;

  return Api.getWells().then(function(wells) {
    if (window.AppState) AppState.activeQuarry = prevQuarry; // restore
    ReportState.allWells = wells;
    if (typeof WellsState !== 'undefined') WellsState.list = wells;
    var meas = (typeof WellsState !== 'undefined') ? WellsState.measurements : {};
    return Promise.all(wells.map(function(w) {
      if (meas[w.id]) return Promise.resolve(); // already cached
      return Api.getWellMeasurements(w.id).then(function(ms) {
        if (typeof WellsState !== 'undefined') WellsState.measurements[w.id] = ms;
      }).catch(function() {
        if (typeof WellsState !== 'undefined') WellsState.measurements[w.id] = [];
      });
    }));
  }).catch(function() {
    if (window.AppState) AppState.activeQuarry = prevQuarry; // restore on error
    ReportState.allWells = [];
  });
}
// ── AI-кэш ───────────────────────────────────────────────
function getAICacheKey(s) {
  var prompt = (s.customPrompt || '').slice(0, 80);
  return [s.dateA, s.dateB, s.reportMode, s.aiModel || '', s.aiTone || '', prompt].join('|');
}
function getCachedAI(key) {
  try {
    var cache = JSON.parse(localStorage.getItem('rp-ai-cache') || '{}');
    var entry = cache[key];
    if (entry && entry.ts && (Date.now() - entry.ts < 24 * 60 * 60 * 1000)) return entry.data;
  } catch(e) {}
  return null;
}
function setCachedAI(key, data) {
  try {
    var cache = JSON.parse(localStorage.getItem('rp-ai-cache') || '{}');
    cache[key] = { ts: Date.now(), data: data };
    // Keep only last 20 entries
    var keys = Object.keys(cache);
    if (keys.length > 20) {
      keys.sort(function(a,b){ return cache[a].ts - cache[b].ts; });
      keys.slice(0, keys.length - 20).forEach(function(k){ delete cache[k]; });
    }
    localStorage.setItem('rp-ai-cache', JSON.stringify(cache));
  } catch(e) {}
}
function clearAICache() {
  localStorage.removeItem('rp-ai-cache');
  var el = document.getElementById('rp-ai-cache-info');
  if (el) el.textContent = 'Кэш очищен';
  Toast.show('AI-кэш очищен', 'success');
}
function updateAICacheInfo() {
  var el = document.getElementById('rp-ai-cache-info');
  if (!el) return;
  try {
    var cache = JSON.parse(localStorage.getItem('rp-ai-cache') || '{}');
    var cnt = Object.keys(cache).length;
    el.textContent = cnt > 0 ? 'Кэш: ' + cnt + ' запис.' : 'Кэш: пусто';
  } catch(e) {}
}

function getAITonePrefix(tone) {
  var prefixes = {
    official:  'Пиши в официальном техническом стиле. Используй профессиональную терминологию. ',
    brief:     'Будь краток — не более 2-3 абзацев, только ключевые факты и выводы. ',
    detailed:  'Дай детальный анализ и конкретные технические рекомендации по каждому пункту. ',
    executive: 'Пиши для руководства без технических деталей. Простой язык, только ключевые выводы и риски. ',
  };
  return prefixes[tone] || prefixes.official;
}

// ── Генерация AI заключения ───────────────────────────────
function generateAIConclusion() {
  var apiKey = getField('rp-apikey');
  if (!apiKey) { Toast.show('Введите Google API ключ', 'error'); return; }
  var btn = document.getElementById('rp-ai-concl-btn');
  if (btn) { btn.disabled = true; btn.textContent = '✨ Генерирую...'; }

  // Обновляем настройки из формы перед вызовом AI
  var s = ReportState.settings;
  s.author   = getField('rp-author') || s.author;
  s.dateA    = getField('rp-date-a') || s.dateA;
  s.dateB    = getField('rp-date-b') || s.dateB;
  var modeEl = document.getElementById('rp-mode-single');
  if (modeEl && modeEl.classList.contains('active')) s.reportMode = 'single';
  // buildAIContext сам вычислит ptsA/ptsB/Q из allPoints
  var ctx = buildAIContext(s);
  // Используем пользовательский промпт если задан
  var userPrompt = (getField('rp-custom-prompt') || s.customPrompt || '').trim();
  var prompt;
  if (userPrompt) {
    prompt = userPrompt + buildDataContext(ctx, ctx.isSingle);
  } else {
    prompt = 'Ты опытный гидрогеолог карьера ЮРГ (Казахстан). ' +
      'Составь профессиональное заключение (3-5 абзацев) по мониторингу подземных вод.' +
      buildDataContext(ctx, ctx.isSingle);
  }

  var tone = getField('rp-ai-tone') || ReportState.settings.aiTone || 'official';
  prompt = getAITonePrefix(tone) + prompt;
  var model = getField('rp-ai-model') || ReportState.settings.aiModel || 'gemini-1.5-flash';
  callGeminiAPI(apiKey, prompt, model).then(function(text) {
    var ta = document.getElementById('rp-conclusions');
    if (ta) ta.value = text;
    Toast.show('Заключение сгенерировано', 'success');
  }).catch(function(err) {
    Toast.show('Ошибка AI: ' + err.message, 'error');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Сгенерировать через AI'; }
  });
}

function callGeminiAPI(apiKey, prompt, model, _attempt) {
  var mdl = model || ReportState.settings.aiModel || 'gemini-1.5-flash';
  var attempt = _attempt || 1;
  var url = 'https://generativelanguage.googleapis.com/v1beta/models/' +
            mdl + ':generateContent?key=' + encodeURIComponent(apiKey);
  return fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: { maxOutputTokens: 1500, temperature: 0.4 }
    })
  }).then(function(r) {
    if (r.status === 429 && attempt <= 4) {
      var delay = Math.pow(2, attempt) * 1000; // 2s, 4s, 8s, 16s
      return new Promise(function(resolve) { setTimeout(resolve, delay); })
        .then(function() { return callGeminiAPI(apiKey, prompt, mdl, attempt + 1); });
    }
    return r.json().then(function(data) {
      if (data.error) {
        var msg = data.error.message || JSON.stringify(data.error);
        if (data.error.code === 429) {
          throw new Error('Превышен лимит запросов Gemini (429). Подождите минуту и попробуйте снова, или используйте другой API-ключ.');
        }
        throw new Error(msg);
      }
      var candidates = data.candidates;
      if (!candidates || !candidates.length) throw new Error('Пустой ответ Gemini API: ' + JSON.stringify(data));
      var parts = candidates[0].content && candidates[0].content.parts;
      if (!parts || !parts.length) throw new Error('Нет текста в ответе Gemini');
      return parts[0].text || '';
    });
  });
}

function buildAIContext(s) {
  // Строит полный контекст для AI — работает в обоих режимах
  // Всегда читаем dateA/dateB из формы для актуальности
  var dateAForm = getField('rp-date-a') || s.dateA || '';
  var dateBForm = getField('rp-date-b') || s.dateB || '';
  var modeSingleBtn = document.getElementById('rp-mode-single');
  var modeForm = (modeSingleBtn && modeSingleBtn.classList.contains('active')) ? 'single'
    : (s.reportMode || 'compare');
  var isSingle = modeForm === 'single' || dateAForm === dateBForm;
  var dateA = dateAForm;
  var dateB = isSingle ? dateAForm : dateBForm;
  // Если s уже заполнен из generateReport — используем его данные
  // Иначе фильтруем allPoints сами
  var allPts = ReportState.allPoints || [];
  var ptsB = (ReportState.ptsB && ReportState.ptsB.length > 0)
    ? ReportState.ptsB
    : allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === dateB; });
  var ptsA = (ReportState.ptsA && ReportState.ptsA.length > 0)
    ? ReportState.ptsA
    : allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === dateA; });
  // Перезаписываем s.dateA/dateB актуальными значениями
  s.dateA = dateA; s.dateB = dateB; s.reportMode = modeForm;
  var allDitches = ReportState.allDitches || [];
  var allDates = (ReportState.allDates || []).slice().sort();

  // Суммарные Q
  var qB = ptsB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
  var qA = ptsA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);

  // Статистика по статусам
  var statusCount = {};
  ptsB.forEach(function(p){
    var st = p.status||'—';
    statusCount[st] = (statusCount[st]||0)+1;
  });
  var statusStr = Object.keys(statusCount).map(function(k){ return k+':'+statusCount[k]; }).join(', ');

  // По горизонтам
  var horizCount = {};
  ptsB.forEach(function(p){
    var h = p.horizon||'—';
    horizCount[h] = (horizCount[h]||0) + (parseFloat(p.flowRate)||0);
  });
  var horizStr = Object.keys(horizCount).map(function(k){ return 'горизонт '+k+': '+horizCount[k].toFixed(2)+' л/с'; }).join('; ');

  // Детали точек (топ-10 по Q)
  var topPts = ptsB.slice().sort(function(a,b){
    return (parseFloat(b.flowRate)||0) - (parseFloat(a.flowRate)||0);
  }).slice(0,10);
  var ptsDetail = topPts.map(function(pb){
    var pa = ptsA.find(function(p){ return p.pointNumber===pb.pointNumber; });
    var qb = parseFloat(pb.flowRate)||0;
    var qa = pa ? parseFloat(pa.flowRate)||0 : null;
    var delta = qa!==null ? (qb-qa) : null;
    var line = 'Точка #'+pb.pointNumber+
      ' ('+pb.status+
      (pb.domain||pb.domen ? ', '+(pb.domain||pb.domen) : '')+
      (pb.horizon ? ', гор.'+pb.horizon+' м' : '')+
      (pb.wall    ? ', борт '+pb.wall : '')+')'+
      ': Q='+qb.toFixed(2)+' л/с'+
      (delta!==null ? ' (была '+qa.toFixed(2)+', Δ='+(delta>=0?'+':'')+delta.toFixed(2)+')' : '')+
      (pb.waterColor ? ', цвет воды: '+pb.waterColor : '')+
      (pb.intensity  ? ', интенсивность: '+pb.intensity : '')+
      (pb.comment    ? '\n  Наблюдение: '+pb.comment : '');
    return line;
  }).join('\n');

  // Канавы
  var ditchStr = allDitches.length > 0
    ? allDitches.slice(0,5).map(function(d){
        // flowLs может быть из нового расчёта, flowM3h — из старого
        var qls = d.flowLs != null ? d.flowLs
          : (d.flowM3h != null ? d.flowM3h / 3.6 : 0);
        return d.ditchName+': Q='+qls.toFixed(2)+' л/с';
      }).join('; ')
    : 'нет данных';

  // Паводковые и критические точки
  var flood = ptsB.filter(function(p){ return p.status==='Паводковая'||p.status==='Перелив'; });
  var floodStr = flood.length > 0
    ? flood.map(function(p){ return '#'+p.pointNumber+' ('+p.status+', Q='+parseFloat(p.flowRate).toFixed(2)+' л/с)'; }).join(', ')
    : 'нет';

  return {
    isSingle: isSingle,
    dateA: s.dateA, dateB: s.dateB,
    totalPts: ptsB.length,
    qB: qB, qA: qA,
    statusStr: statusStr,
    horizStr: horizStr,
    ptsDetail: ptsDetail,
    ditchStr: ditchStr,
    floodStr: floodStr,
    allDatesCount: allDates.length,
  };
}

function buildDataContext(ctx, isSingleMode) {
  // Формирует блок данных для подстановки в любой промпт
  var dataBlock = '\n\n--- ДАННЫЕ МОНИТОРИНГА ---\n';
  if (isSingleMode) {
    dataBlock += 'Дата замера: ' + ctx.dateB + '\n';
    dataBlock += 'Точек мониторинга: ' + ctx.totalPts + ' шт.\n';
    dataBlock += 'Суммарный Q: ' + ctx.qB.toFixed(2) + ' л/с (' + (ctx.qB*3.6).toFixed(2) + ' м³/ч)\n';
  } else {
    dataBlock += 'Период А (' + ctx.dateA + '): ' + (ReportState.ptsA||[]).length + ' точек, Q=' + ctx.qA.toFixed(2) + ' л/с\n';
    dataBlock += 'Период Б (' + ctx.dateB + '): ' + ctx.totalPts + ' точек, Q=' + ctx.qB.toFixed(2) + ' л/с\n';
    dataBlock += 'Изменение Q: ' + (ctx.qB-ctx.qA>=0?'+':'') + (ctx.qB-ctx.qA).toFixed(2) + ' л/с';
    dataBlock += ctx.qA>0 ? ' (' + ((ctx.qB-ctx.qA)/ctx.qA*100).toFixed(0) + '%)\n' : '\n';
  }
  dataBlock += 'Статусы точек: ' + ctx.statusStr + '\n';
  dataBlock += 'По горизонтам: ' + ctx.horizStr + '\n';
  dataBlock += 'Паводковые/Перелив: ' + ctx.floodStr + '\n';
  dataBlock += 'Канавы: ' + ctx.ditchStr + '\n';
  dataBlock += '\nДетали топ-10 точек:\n' + ctx.ptsDetail + '\n';
  dataBlock += '\nВАЖНО: используй только эти цифры. Суммарный Q = ' + ctx.qB.toFixed(2) + ' л/с.\n';
  dataBlock += 'Ответь только текстом, без JSON, без markdown, без заголовков.';
  return dataBlock;
}

function generateAIBlocks(s) {
  if (!s.apiKey) return Promise.resolve({});
  // Check cache first
  var cacheKey = getAICacheKey(s);
  var cached = getCachedAI(cacheKey);
  if (cached) {
    setTimeout(updateAICacheInfo, 0);
    return Promise.resolve(Object.assign({ _fromCache: true }, cached));
  }
  var ctx = buildAIContext(s);

  // Tone prefix
  var tonePrefix = getAITonePrefix(s.aiTone);
  // Пользовательский промпт из поля (или дефолтный)
  var userPrompt = (s.customPrompt || '').trim();
  var prompt;
  if (userPrompt) {
    // Пользователь написал свой промпт — подставляем данные в конце
    prompt = tonePrefix + userPrompt + buildDataContext(ctx, ctx.isSingle);
  } else {
    // Дефолтный промпт
    if (ctx.isSingle) {
      prompt = tonePrefix + 'Ты опытный гидрогеолог карьера ЮРГ (Казахстан). ' +
        'Составь профессиональный вывод по гидрогеологической обстановке. ' +
        'Укажи суммарный водоприток, основные зоны, состояние паводковых точек. Без рекомендаций.' +
        buildDataContext(ctx, true);
    } else {
      prompt = tonePrefix + 'Ты опытный гидрогеолог карьера ЮРГ (Казахстан). ' +
        'Составь сравнительный анализ двух периодов мониторинга. ' +
        'Укажи динамику Q, зоны роста/снижения водопритока, паводковые риски. Без рекомендаций.' +
        buildDataContext(ctx, false);
    }
  }

  return callGeminiAPI(s.apiKey, prompt, s.aiModel).then(function(text) {
    var clean = text.replace(/```/g,'').trim();
    var result = { summary: clean, compare: '', recommendations: '' };
    setCachedAI(cacheKey, result);
    setTimeout(updateAICacheInfo, 0);
    return result;
  }).catch(function(err) {
    return { error: err && err.message ? err.message : 'Ошибка API' };
  });
}

// ── Захват карты ──────────────────────────────────────────
function captureMapCanvas() {
  try {
    var canvas = document.getElementById('map-canvas');
    if (!canvas) return null;
    var dataUrl = canvas.toDataURL('image/jpeg', 0.85);
    return (dataUrl && dataUrl.length > 6000) ? dataUrl : null;
  } catch(e) { return null; }
}

// Получает URL схемы карьера напрямую из API (без canvas — избегаем CORS SecurityError).
// weekKey: "2026-W13" или null (берёт последнюю). quarryName: "ЮРГ" и т.п.
function fetchSchemeUrl(weekKey, quarryName) {
  var qName = quarryName || (ReportState.settings && ReportState.settings.quarryName) || '';
  var fetch$ = (qName && typeof Api !== 'undefined' && Api.getSchemesByQuarry)
    ? Api.getSchemesByQuarry(qName)
    : (typeof Schemes !== 'undefined' ? Promise.resolve(Schemes.getList()) : Promise.resolve([]));

  return fetch$.then(function(schemes) {
    if (!schemes || !schemes.length) return null;
    // Sort newest first
    var sorted = schemes.slice().sort(function(a, b) {
      return (a.weekKey || '') > (b.weekKey || '') ? -1 : 1;
    });
    if (weekKey && weekKey !== 'auto') {
      var exact = sorted.find(function(s) { return s.weekKey === weekKey; });
      if (exact) return exact.driveUrl || null;
      // Find closest week before weekKey
      var before = sorted.filter(function(s) { return (s.weekKey || '') <= weekKey; });
      if (before.length) return before[0].driveUrl || null;
    }
    return sorted[0].driveUrl || null;
  }).catch(function() { return null; });
}

function captureMapForWeek(weekKey, quarryName) {
  var qName = quarryName || (ReportState.settings && ReportState.settings.quarryName) || '';

  // Primary: render map canvas with monitoring points drawn on it.
  // crossOrigin='anonymous' is set on the scheme image in ui-map.js so toDataURL() works.
  return new Promise(function(resolve) {
    if (typeof switchTab !== 'function') { resolve(null); return; }
    var switchQ = (qName && typeof switchQuarry === 'function' && window.AppState && AppState.activeQuarry !== qName)
      ? new Promise(function(res) { switchQuarry(qName, true); setTimeout(res, 800); })
      : Promise.resolve();
    switchQ.then(function() {
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
        if (attempts >= 20) {
          // Fallback: return scheme URL directly (without monitoring points)
          fetchSchemeUrl(weekKey, qName).then(resolve);
          return;
        }
        setTimeout(tryCapture, 500);
      }
      setTimeout(tryCapture, 1000);
    });
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
  if (!url) return Promise.resolve(null);
  return fetch(url)
    .then(function(r) { return r.ok ? r.blob() : null; })
    .then(function(blob) {
      if (!blob) return null;
      return new Promise(function(resolve) {
        var fr = new FileReader();
        fr.onload  = function() { resolve(fr.result); };
        fr.onerror = function() { resolve(null); };
        fr.readAsDataURL(blob);
      });
    })
    .catch(function() { return null; });
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

function captureDewDiagram() {
  var svg = document.getElementById('dew-diagram-svg');
  if (!svg) return null;
  try {
    var canvas = document.getElementById('dew-diagram-canvas');
    var w = canvas ? (parseInt(canvas.style.width)  || 2400) : 2400;
    var h = canvas ? (parseInt(canvas.style.height) || 1200) : 1200;
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('width', String(w));
    clone.setAttribute('height', String(h));
    // Dark background
    var bg = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    bg.setAttribute('width', '100%'); bg.setAttribute('height', '100%'); bg.setAttribute('fill', '#141928');
    clone.insertBefore(bg, clone.firstChild);
    // Remove animated elements (SMIL animations cause issues in static export)
    clone.querySelectorAll('animate,animateTransform').forEach(function(a){ a.remove(); });
    var svgStr = new XMLSerializer().serializeToString(clone);
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgStr);
  } catch(e) { return null; }
}

function preGenerateAI() {
  var apiKey = getField('rp-apikey');
  if (!apiKey) { Toast.show('Введите Google API ключ', 'error'); return; }
  if (!ReportState.allPoints.length) { Toast.show('Сначала загрузите данные (Шаг 1)', 'error'); return; }

  var btn = document.getElementById('rp-pre-ai-btn');
  var container = document.getElementById('rp-ai-preview-blocks');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }
  if (container) container.innerHTML = '<div style="font-size:12px;color:var(--txt-3);text-align:center;padding:12px">Запрос к Gemini API...</div>';

  var s = Object.assign({}, ReportState.settings);
  s.author       = getField('rp-author');
  s.position     = getField('rp-position');
  s.dateA        = getField('rp-date-a');
  s.dateB        = getField('rp-date-b');
  s.reportMode   = ReportState.settings.reportMode || 'compare';
  s.dateB        = s.reportMode === 'single' ? s.dateA : s.dateB;
  s.apiKey       = apiKey;
  s.customPrompt = getField('rp-custom-prompt');
  s.aiModel = getField('rp-ai-model') || ReportState.settings.aiModel || 'gemini-1.5-flash';
  s.aiTone  = getField('rp-ai-tone')  || ReportState.settings.aiTone  || 'official';

  var allPts = ReportState.allPoints || [];
  ReportState.ptsA = allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === s.dateA; });
  ReportState.ptsB = allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === s.dateB; });

  generateAIBlocks(s).then(function(aiBlocks) {
    ReportState.aiText = aiBlocks || {};
    renderAIPreviewBlocks();
  }).catch(function(err) {
    Toast.show('Ошибка AI: ' + (err && err.message ? err.message : String(err)), 'error');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Сгенерировать тексты'; }
  });
}

function renderAIPreviewBlocks() {
  var container = document.getElementById('rp-ai-preview-blocks');
  if (!container) return;
  var ai = ReportState.aiText || {};
  var blocks = [
    { key: 'summary',         label: 'Сводный анализ' },
    { key: 'compare',         label: 'Сравнительный анализ' },
    { key: 'recommendations', label: 'Рекомендации' },
  ];
  if (ai.error) {
    container.innerHTML = '<div style="color:var(--red);font-size:12px;padding:8px">⚠ ' + escHTML(ai.error) + '</div>';
    return;
  }
  var hasContent = blocks.some(function(b){ return !!ai[b.key]; });
  if (!hasContent) {
    container.innerHTML = '<div style="font-size:11px;color:var(--txt-3);text-align:center;padding:8px">AI не вернул текстов</div>';
    return;
  }
  container.innerHTML = blocks.filter(function(b){ return !!ai[b.key]; }).map(function(b) {
    return '<div>' +
      '<div style="font-size:11px;font-weight:700;color:var(--txt-2);margin-bottom:4px">' + b.label + '</div>' +
      '<textarea class="form-textarea" rows="4" style="font-size:12px;line-height:1.5" ' +
        'oninput="ReportState.aiText[\'' + b.key + '\']=this.value">' + escHTML(ai[b.key] || '') + '</textarea>' +
    '</div>';
  }).join('');
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
  s.author      = getField('rp-author');
  s.position    = getField('rp-position');
  s.dateReport  = getField('rp-date');
  s.reportMode  = ReportState.settings.reportMode || 'compare';
  s.dateA       = getField('rp-date-a');
  s.dateB       = s.reportMode === 'single' ? s.dateA : getField('rp-date-b');
  s.weekA       = getWeekNumber(s.dateA);
  s.weekB       = s.reportMode === 'single' ? s.weekA : getWeekNumber(s.dateB);
  s.conclusions  = getField('rp-conclusions');
  s.apiKey       = getField('rp-apikey');
  s.customPrompt = getField('rp-custom-prompt');
  s.includeDomens  = !!(document.getElementById('rp-inc-domens')  || {checked:true}).checked;
  s.includeDitches = !!(document.getElementById('rp-inc-ditches') || {checked:true}).checked;
  s.includePhotos   = !!(document.getElementById('rp-inc-photos')   || {checked:true}).checked;
  s.includeMap     = !!(document.getElementById('rp-inc-map')     || {checked:true}).checked;
  s.includeHistory = !!(document.getElementById('rp-inc-history') || {checked:true}).checked;
  s.includeCompare = !!(document.getElementById('rp-inc-compare') || {checked:true}).checked;
  s.includeAI      = !!(document.getElementById('rp-inc-ai')      || {checked:true}).checked;
  s.includeDewatering = !!(document.getElementById('rp-inc-dewatering') || {checked:false}).checked;
  s.includeWells      = !!(document.getElementById('rp-inc-wells')      || {checked:false}).checked;
  s.orientation       = ReportState.settings.orientation || 'portrait';
  s.quarryName     = getField('rp-quarry-name') || 'ЮРГ';
  s.objectName     = getField('rp-object-name') || 'Пулково-42';
  s.reportTheme = ReportState.settings.reportTheme || 'blue';
  s.reportLayout = ReportState.settings.reportLayout || 'a';
  s.logoBase64   = localStorage.getItem('rp-logo-base64') || '';
  var wmVal = getField('rp-watermark');
  s.watermark    = wmVal === 'custom' ? getField('rp-watermark-custom') : wmVal;
  s.approverName = getField('rp-approver-name');
  s.includeSignature = getChk('rp-inc-signature');
  s.aiModel = getField('rp-ai-model') || ReportState.settings.aiModel || 'gemini-1.5-flash';
  s.aiTone  = getField('rp-ai-tone')  || ReportState.settings.aiTone  || 'official';
  s.reportVersion  = (parseInt(s.reportVersion) || 0) + 1;
  addRpHistory(s);
  saveReportSettings();

  // Фильтруем данные по датам
  var allPts = ReportState.allPoints || [];
  var allDts = ReportState.allDitches || [];
  ReportState.ptsA = allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === s.dateA; });
  ReportState.ptsB = allPts.filter(function(p){ return (p.monitoringDate||'').slice(0,10) === s.dateB; });
  ReportState.dtsA = allDts.filter(function(d){ return (d.monitoringDate||'').slice(0,10) === s.dateA; });
  ReportState.dtsB = allDts.filter(function(d){ return (d.monitoringDate||'').slice(0,10) === s.dateB; });

  // Apply domain filter
  var fDom = s.filterDomains || [];
  if (fDom.length > 0) {
    ReportState.ptsA = ReportState.ptsA.filter(function(p){ return fDom.indexOf(p.domain||p.domen||'—') >= 0; });
    ReportState.ptsB = ReportState.ptsB.filter(function(p){ return fDom.indexOf(p.domain||p.domen||'—') >= 0; });
  }
  // Apply horizon filter
  var fHor = s.filterHorizons || [];
  if (fHor.length > 0) {
    ReportState.ptsA = ReportState.ptsA.filter(function(p){ return fHor.indexOf(p.horizon||p.gorizont||'') >= 0; });
    ReportState.ptsB = ReportState.ptsB.filter(function(p){ return fHor.indexOf(p.horizon||p.gorizont||'') >= 0; });
  }

  s.dewDiagImg = s.includeDewatering ? captureDewDiagram() : null;

  Toast.progress('rp-gen', 'Захват схем карьера...');

  var wkA = dateToWeekKey(s.dateA);
  var wkB = dateToWeekKey(s.dateB);
  var mapPromise = s.includeMap
    ? captureMapByWeekKeys(wkA, wkB, s.reportMode)
    : Promise.resolve({ imgA: null, imgB: null });

  mapPromise.then(function(mapImgs) {
    ReportState.mapImgs = mapImgs || { imgA: null, imgB: null };
    // Capture wells map: try SVG first (exists if user visited wells tab), else use scheme URL directly
    if (s.includeWells) {
      var wellsSvgEl = document.getElementById('wells-map-svg');
      if (wellsSvgEl) {
        try {
          // Inline the background image so it renders inside an embedded SVG data URI
          var bgEl = wellsSvgEl.querySelector('#wells-map-bg');
          var bgUrl = (ReportState.mapImgs && (ReportState.mapImgs.imgB || ReportState.mapImgs.imgA)) || null;
          var origHref = null;
          if (bgEl && bgUrl) {
            origHref = bgEl.getAttribute('href') || bgEl.getAttribute('xlink:href') || null;
            bgEl.setAttribute('href', bgUrl);
            bgEl.removeAttribute('xlink:href');
          }
          var svgStr = new XMLSerializer().serializeToString(wellsSvgEl);
          ReportState.wellsMapSvg = 'data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(svgStr)));
          if (bgEl && origHref !== null) bgEl.setAttribute('href', origHref);
        } catch(e) { ReportState.wellsMapSvg = null; }
      } else {
        ReportState.wellsMapSvg = null;
      }
    }
    if (s.includePhotos) {
      Toast.progress('rp-gen', 'Загрузка фотографий...');
      return preloadAllPhotos(ReportState.ptsA, ReportState.ptsB, ReportState.dtsA, ReportState.dtsB);
    }
    return Promise.resolve();

  }).then(function() {
    // AI текстовый анализ (если включён)
    if (s.includeAI && s.apiKey) {
      // If already pre-generated and has content, skip re-generation
      var existing = ReportState.aiText || {};
      if (existing.summary || existing.compare || existing.recommendations) {
        return Promise.resolve(existing);
      }
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

    // Always download as file AND open preview in new tab
    var blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    var blobUrl = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = blobUrl;
    a.download = 'report-' + escAttr((s.quarryName||'yrg').toLowerCase().replace(/\s+/g,'_')) +
                 '-v' + s.reportVersion + '.html';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    // Also open preview
    setTimeout(function() { window.open(blobUrl, '_blank'); }, 300);
  }).catch(function(err) {
    var msg = err && err.message ? err.message : String(err);
    console.error('[generateReport] ошибка:', msg, err);
    Toast.fail('rp-gen', 'Ошибка генерации: ' + msg);
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
        escAttr(k) + '</span><b>' + counts[k] + '</b></div>';
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
        (isUnk ? '— не указан —' : '⛰ ' + escAttr(k)) + '</td>' +
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
    (label ? '<div style="font-size:11px;font-weight:600;color:' + (color||'#1a73e8') + ';margin-bottom:5px">' + escAttr(label) + '</div>' : '') +
    '<table style="width:100%">' +
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

  // Нормализуем даты до ISO перед сортировкой
  function normalizeToISO(raw) {
    raw = (raw||'').trim();
    if (raw.match(/^\d{4}-\d{2}-\d{2}/)) return raw.slice(0,10);
    var d = new Date(raw);
    if (!isNaN(d.getTime())) {
      return d.getFullYear()+'-'+('0'+(d.getMonth()+1)).slice(-2)+'-'+('0'+d.getDate()).slice(-2);
    }
    return raw.slice(0,10);
  }
  var sorted = hist.slice().sort(function(a,b) {
    var da = normalizeToISO(a.monitoringDate);
    var db = normalizeToISO(b.monitoringDate);
    return da < db ? -1 : da > db ? 1 : 0;
  });
  var data = sorted.filter(function(h) {
    return h.flowRate != null && !isNaN(parseFloat(h.flowRate));
  }).map(function(h) {
    // Нормализуем дату: берём первые 10 символов ISO-строки YYYY-MM-DD
    var rawDate = (h.monitoringDate||'').trim();
    var isoDate;
    var isoMatch = rawDate.match(/\d{4}-\d{2}-\d{2}/);
    if (isoMatch) {
      isoDate = isoMatch[0]; // Уже ISO: "2026-04-18"
    } else {
      // Пробуем распарсить любой формат через Date
      var parsed = new Date(rawDate);
      if (!isNaN(parsed.getTime())) {
        var y = parsed.getFullYear();
        var mo = ('0'+(parsed.getMonth()+1)).slice(-2);
        var d  = ('0'+parsed.getDate()).slice(-2);
        isoDate = y+'-'+mo+'-'+d;
      } else {
        isoDate = rawDate.slice(0,10);
      }
    }
    return { date: isoDate, q: parseFloat(h.flowRate)||0 };
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

// Нормализует дату любого формата в ISO YYYY-MM-DD
function normDateISO(raw) {
  raw = (raw || '').trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  var d = new Date(raw);
  if (!isNaN(d.getTime())) {
    return d.getFullYear() + '-' +
      ('0' + (d.getMonth() + 1)).slice(-2) + '-' +
      ('0' + d.getDate()).slice(-2);
  }
  return '';
}

function buildPointCard(pb, pa, s) {
  var qb = parseFloat(pb.flowRate) || 0;
  var isSingle = s.reportMode === 'single';

  // In single mode ptsA===ptsB (same date), so passed pa is the same record — not a "previous" value
  if (isSingle && pa && normDateISO(pa.monitoringDate) === normDateISO(pb.monitoringDate)) {
    pa = null;
  }

  // В single режиме pa может быть null — берём предыдущую дату из истории
  if (pa == null && isSingle) {
    var hist = (ReportState.ptHistory || {})[String(pb.pointNumber)] || [];
    var pbDateISO = normDateISO(pb.monitoringDate);
    var prevEntries = hist.filter(function(h) {
      var hDateISO = normDateISO(h.monitoringDate);
      return hDateISO && pbDateISO && hDateISO < pbDateISO &&
             h.flowRate != null && !isNaN(parseFloat(h.flowRate));
    }).sort(function(a, b) {
      // Сортируем по возрастанию (ASC) — берём последний = ближайший к текущей дате
      var da = normDateISO(a.monitoringDate);
      var db = normDateISO(b.monitoringDate);
      return da < db ? -1 : da > db ? 1 : 0;
    });
    if (prevEntries.length > 0) pa = prevEntries[prevEntries.length - 1];
  }

  var qa = pa != null ? parseFloat(pa.flowRate) || 0 : null;
  var delta = qa != null ? qb - qa : null;
  var cache = ReportState.photoCache || {};

  var trendColor = delta == null ? '#888' : (delta > 0.001 ? '#d93025' : (delta < -0.001 ? '#188038' : '#888'));
  var trendArrow = delta == null ? '' : (delta > 0.001 ? '▲' : (delta < -0.001 ? '▼' : '→'));

  // Получаем фото из кэша по суффиксу периода
  function getPhotoSrc(pointNum, suffix) {
    return cache['pt_' + pointNum + '_0_' + suffix] || null;
  }

  // Compact photo height: 140px to allow 2 cards per portrait page
  var PHOTO_H = '140px';
  function photoBlock(src, weekLabel, dateLabel, labelBg) {
    var imgHtml = src
      ? '<img src="' + src + '" style="width:100%;height:' + PHOTO_H + ';object-fit:cover;display:block" alt="' + escAttr(weekLabel) + '">'
      : '<div style="height:' + PHOTO_H + ';display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;background:#f8f9fa">' +
          '<div style="width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;' +
            'background:' + (labelBg === '#888' ? '#e8e8e8' : '#e8f0fe') + ';color:' + labelBg + '">' +
            (labelBg === '#888' ? 'А' : 'Б') + '</div>' +
          '<span style="font-size:10px;color:#bbb">фото отсутствует</span>' +
        '</div>';
    return '<div style="flex:1;min-width:0">' +
      imgHtml +
      '<div style="display:flex;align-items:center;gap:6px;padding:3px 8px;border-top:1px solid #e0e6f0">' +
        '<span style="width:7px;height:7px;border-radius:50%;background:' + labelBg + ';flex-shrink:0"></span>' +
        '<span style="font-size:10px;font-weight:600;color:#444">' + escAttr(weekLabel) + '</span>' +
        '<span style="font-size:10px;color:#888;margin-left:auto">' + escAttr(dateLabel) + '</span>' +
      '</div>' +
    '</div>';
  }

  // ── Шапка
  var header = '<div style="display:flex;align-items:center;gap:8px;background:#f7f9fc;padding:8px 14px;border-bottom:1px solid #e0e6f0">' +
    '<span style="font-size:15px;font-weight:700;color:#1a1a2e">#' + escAttr(String(pb.pointNumber)) + '</span>' +
    '<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#e6f4ea;color:#188038;font-weight:600">' + escAttr(pb.status || '—') + '</span>' +
    '<span style="font-size:11px;color:#666">' + escAttr(pb.intensity || '') + (pb.waterColor ? ' · ' + escAttr(pb.waterColor) : '') + (pb.horizon ? ' · гор. ' + escAttr(String(pb.horizon)) : '') + '</span>' +
    '<div style="margin-left:auto;display:flex;align-items:center;gap:8px;font-size:12px">' +
      (qa != null ? '<span style="color:#888">' +
        (isSingle
          ? (pa && pa.monitoringDate ? normDateISO(pa.monitoringDate).slice(5).split('-').reverse().join('.') + ' ' : 'Пред. ')
          : 'нед. А ') +
        ': <b>' + qa.toFixed(2) + '</b></span><span style="color:#ccc">→</span>' : '') +
      '<span style="color:#1a73e8;font-weight:700">' +
        (isSingle
          ? (pb.monitoringDate ? normDateISO(pb.monitoringDate).slice(5).split('-').reverse().join('.') + ' ' : 'Текущий ')
          : 'нед. Б ') +
        ': ' + qb.toFixed(2) + ' л/с</span>' +
      (delta != null ? '<span style="font-weight:700;color:' + trendColor + '">' + trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + '</span>' : '') +
    '</div>' +
  '</div>';

  // ── Фото (2 колонки для сравнения, 1 для одиночного)
  var photosRow = '';
  if (!isSingle && pa != null) {
    var srcA = getPhotoSrc(pb.pointNumber, 'a');
    var srcB = getPhotoSrc(pb.pointNumber, 'b');
    photosRow = '<div style="display:flex;gap:0;border-bottom:1px solid #e0e6f0">' +
      photoBlock(srcA, 'Неделя А', fmtDate(s.dateA) + ' · ' + escAttr(s.weekA), '#888') +
      '<div style="width:1px;background:#e0e6f0;flex-shrink:0"></div>' +
      photoBlock(srcB, 'Неделя Б', fmtDate(s.dateB) + ' · ' + escAttr(s.weekB), '#1a73e8') +
    '</div>';
  } else if (s.includePhotos) {
    var srcB2 = getPhotoSrc(pb.pointNumber, 'b') || getPhotoSrc(pb.pointNumber, 'a');
    if (srcB2) {
      photosRow = '<div style="border-bottom:1px solid #e0e6f0">' +
        '<img src="' + srcB2 + '" style="width:100%;height:' + PHOTO_H + ';object-fit:cover;display:block">' +
        '<div style="padding:3px 10px;font-size:10px;color:#888;background:#f8f9fa">' + fmtDate(s.dateB) + ' · ' + escAttr(s.weekB) + '</div>' +
      '</div>';
    }
  }

  // ── График на всю ширину
  var chartRow = '';
  if (s.includeHistory) {
    var chartHtml = buildPointHistoryChart(pb.pointNumber, s.dateA, s.dateB);
    if (chartHtml) {
      chartRow = '<div style="padding:6px 12px 8px;border-bottom:1px solid #e0e6f0">' +
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:4px">Динамика водопритока Q, л/с</div>' +
        chartHtml +
      '</div>';
    }
  }

  // ── Метрики (4 ячейки)
  var numHist = ((ReportState.ptHistory || {})[String(pb.pointNumber)] || []).length;
  var metricsRow = '<div style="display:grid;grid-template-columns:repeat(4,1fr);gap:1px;background:#e0e6f0">' +
    (qa != null
      ? '<div style="background:#fff;padding:5px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:2px">' + (isSingle && pa && pa.monitoringDate ? normDateISO(pa.monitoringDate).slice(5).split('-').reverse().join('.') : 'Q нед. А') + '</div>' +
          '<div style="font-size:13px;font-weight:700;color:#1a1a2e">' + qa.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span></div></div>'
      : '<div style="background:#fff;padding:5px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:2px">Метод</div>' +
          '<div style="font-size:11px;color:#555">' + escAttr(pb.measureMethod || '—') + '</div></div>') +
    '<div style="background:#fff;padding:5px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:2px">' + (isSingle && pb.monitoringDate ? normDateISO(pb.monitoringDate).slice(5).split('-').reverse().join('.') : 'Q нед. Б') + '</div>' +
      '<div style="font-size:13px;font-weight:700;color:#1a73e8">' + qb.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span></div></div>' +
    '<div style="background:#fff;padding:5px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:2px">Изменение</div>' +
      '<div style="font-size:13px;font-weight:700;color:' + trendColor + '">' +
        (delta != null ? trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span>' : '—') +
      '</div></div>' +
    '<div style="background:#fff;padding:5px 10px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:2px">Замеров в истории</div>' +
      '<div style="font-size:13px;font-weight:700;color:#555">' + numHist + '</div></div>' +
  '</div>';

  // ── Комментарий (полевое описание — гидрогеологическое наблюдение)
  var commentRow = pb.comment
    ? '<div style="padding:6px 12px;border-top:1px solid #e0e6f0;' +
        'background:#fffde7;border-left:3px solid #f9ab00">' +
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;' +
          'color:#b8860b;font-weight:700;margin-bottom:2px">Полевое наблюдение</div>' +
        '<div style="font-size:11px;line-height:1.5;color:#333">' + escAttr(pb.comment) + '</div>' +
      '</div>'
    : '';

  return '<div style="border:1px solid #e0e6f0;border-radius:8px;overflow:hidden;margin-bottom:8px;page-break-inside:avoid;break-inside:avoid">' +
    header + photosRow + chartRow + metricsRow + commentRow +
  '</div>';
}

// Фото канавы
function buildDitchPhotos(d) {
  var cache = ReportState.photoCache || {};
  var urls  = Array.isArray(d.photoUrls) ? d.photoUrls.filter(Boolean) : [];
  var html  = '';
  urls.forEach(function(url, i) {
    var b64 = cache['dt_' + (d.id || d.ditchName) + '_' + i] || url;
    if (!b64) return;
    html += '<div class="photo-row">' +
      '<div class="photo-img-wrap"><img src="' + b64 + '" alt="' + escAttr(d.ditchName) + '" class="photo-img">' +
        '<div class="photo-img-lbl">' + escAttr(d.ditchName) + ' · фото ' + (i+1) + '</div></div>' +
      '<div class="photo-info">' +
        '<div class="photo-info-title">' + escAttr(d.ditchName) + '</div>' +
        '<table style="font-size:11px;margin-bottom:8px;width:auto">' +
          '<tr><td style="color:#888;width:90px;font-size:10px;text-transform:uppercase;padding:2px 6px 2px 0">Дата</td><td>' + fmtDate(d.monitoringDate) + '</td></tr>' +
          '<tr><td style="color:#888;font-size:10px;text-transform:uppercase;padding:2px 6px 2px 0">Статус</td><td>' + escAttr(d.status||'—') + '</td></tr>' +
          '<tr><td style="color:#888;font-size:10px;text-transform:uppercase;padding:2px 6px 2px 0">Q</td><td>' + (d.flowM3h!=null?d.flowM3h.toFixed(3)+' м³/ч':'—') + '</td></tr>' +
        '</table>' +
        (d.comment ? '<div class="photo-comment"><b>Комментарий:</b> ' + escAttr(d.comment) + '</div>' : '') +
      '</div></div>';
  });
  return html ? '<div style="padding:10px 12px;border-top:1px solid #e0e0e0;display:flex;flex-direction:column;gap:10px">' + html + '</div>' : '';
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

  return '<div style="padding:8px 12px;border-top:1px solid #e0e0e0">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:6px;text-align:center">Профиль поперечного сечения</div>' +
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
    return '<tr><td>' + escAttr(String(h.monitoringDate||'—')) + '</td>' +
      '<td>' + (h.area!=null?h.area.toFixed(4):'—') + '</td>' +
      '<td><b>' + (h.flowM3h!=null?h.flowM3h.toFixed(3):'—') + '</b></td>' +
      '<td>' + (h.velocity!=null?h.velocity.toFixed(3):'—') + '</td>' +
      '<td>' + escAttr(h.worker||'—') + '</td></tr>';
  }).join('');
  return '<div style="padding:0 14px 14px"><div class="sec-sub">История замеров</div>' +
    '<table><thead><tr><th>Дата</th><th>S, м²</th><th>Q, м³/ч</th><th>v, м/с</th><th>Сотрудник</th></tr></thead>' +
    '<tbody>' + rows + '</tbody></table></div>';
}

// ── Секция водоотлива ─────────────────────────────────────
function buildDewateringSection(s) {
  if (typeof DewateringState === 'undefined') return '';

  var isSingle = s.reportMode === 'single';
  var dateFrom = isSingle ? s.dateB : s.dateA;
  var dateTo   = s.dateB;
  if (!dateFrom || !dateTo) return '';

  // Pump readings in the period
  var readings = (DewateringState.meterReadings || []).filter(function(r) {
    return r.date >= dateFrom && r.date <= dateTo;
  });

  // Volume per pump
  var pumpVolMap = {};
  readings.forEach(function(r) {
    var vol = DewateringState.computedVolume ? (DewateringState.computedVolume(r) || 0) : 0;
    pumpVolMap[r.pumpId] = (pumpVolMap[r.pumpId] || 0) + vol;
  });

  var totalVol = Object.keys(pumpVolMap).reduce(function(a, id) { return a + pumpVolMap[id]; }, 0);
  var activePumps = (DewateringState.pumps || []).filter(function(p) {
    return p.status === 'working';
  });

  // Water levels in period (latest per sump)
  var latestLevel = {};
  (DewateringState.waterLevels || [])
    .filter(function(w) { return w.date >= dateFrom && w.date <= dateTo; })
    .forEach(function(w) {
      if (!latestLevel[w.sumpId] || w.date > latestLevel[w.sumpId].date) {
        latestLevel[w.sumpId] = w;
      }
    });

  // Sumps
  var sumps = DewateringState.sumps || [];
  if (!sumps.length && !readings.length) return '';

  // KPI row
  var kpiHtml =
    '<div class="kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
      '<div class="kpi-card"><div class="kpi-val">' + sumps.length + '</div><div class="kpi-lbl">Зумпфов</div></div>' +
      '<div class="kpi-card"><div class="kpi-val">' + activePumps.length + '</div><div class="kpi-lbl">Работающих насосов</div></div>' +
      '<div class="kpi-card"><div class="kpi-val">' + Math.round(totalVol).toLocaleString('ru-RU') + '</div><div class="kpi-lbl">Объём откачки, м³</div></div>' +
      '<div class="kpi-card"><div class="kpi-val">' + Object.keys(latestLevel).length + '</div><div class="kpi-lbl">Зумпфов с замерами уровня</div></div>' +
    '</div>';

  // Pumps table
  var pumpRows = (DewateringState.pumps || []).map(function(p) {
    var vol = pumpVolMap[p.id] || 0;
    var sump = DewateringState.sumpById ? DewateringState.sumpById(p.sumpId) : null;
    var STATUS_RU = { working:'Работает', standby:'Резерв', repair:'Ремонт', off:'Отключён' };
    var statusTxt = STATUS_RU[p.status] || p.status || '—';
    var statusClr = p.status === 'working' ? '#188038' : p.status === 'repair' ? '#d93025' : '#888';
    return '<tr>' +
      '<td><b>' + escHTML(p.name || p.id) + '</b></td>' +
      '<td>' + escHTML(sump ? sump.name : p.sumpId || '—') + '</td>' +
      '<td style="color:' + statusClr + ';font-weight:600">' + escHTML(statusTxt) + '</td>' +
      '<td>' + escHTML(p.model || '—') + '</td>' +
      '<td style="text-align:right"><b>' + (vol > 0 ? Math.round(vol).toLocaleString('ru-RU') : '—') + '</b></td>' +
    '</tr>';
  }).join('');

  var pumpsTable = pumpRows
    ? '<div class="sec-sub">Насосы</div>' +
      '<table><thead><tr>' +
        '<th>Насос</th><th>Зумпф</th><th>Статус</th><th>Модель</th><th style="text-align:right">Объём, м³</th>' +
      '</tr></thead><tbody>' + pumpRows + '</tbody></table>'
    : '';

  // Water levels table
  var wlRows = sumps.filter(function(su) { return latestLevel[su.id]; }).map(function(su) {
    var wl = latestLevel[su.id];
    var elev = DewateringState.sumpCurrentElevation ? DewateringState.sumpCurrentElevation(su.id) : null;
    var depth = (wl.elevation != null && elev != null) ? (wl.elevation - elev).toFixed(2) + ' м' : '—';
    return '<tr>' +
      '<td><b>' + escHTML(su.name) + '</b></td>' +
      '<td>' + escHTML(su.quarry || '—') + '</td>' +
      '<td>' + escHTML(wl.date ? wl.date : '—') + '</td>' +
      '<td style="text-align:right"><b>' + (wl.elevation != null ? wl.elevation.toFixed(2) + ' м абс.' : '—') + '</b></td>' +
      '<td style="text-align:right">' + depth + '</td>' +
    '</tr>';
  }).join('');

  var wlTable = wlRows
    ? '<div class="sec-sub" style="margin-top:14px">Отметки уровня воды в зумпфах</div>' +
      '<table><thead><tr>' +
        '<th>Зумпф</th><th>Карьер</th><th>Дата замера</th>' +
        '<th style="text-align:right">Уровень</th><th style="text-align:right">Глубина</th>' +
      '</tr></thead><tbody>' + wlRows + '</tbody></table>'
    : '';

  if (!kpiHtml && !pumpsTable && !wlTable) return '';

  return (s.dewDiagImg ? '<div style="margin-bottom:16px;text-align:center"><img src="' + s.dewDiagImg + '" style="max-width:100%;border-radius:8px;border:1px solid #e0e0e0" alt="Схема водоотлива"></div>' : '') +
    '<div style="font-size:11px;color:#888;margin-bottom:10px">Период: ' +
      escHTML(dateFrom) + (dateFrom !== dateTo ? ' — ' + escHTML(dateTo) : '') +
    '</div>' +
    kpiHtml + pumpsTable + wlTable;
}

// ── Титульная страница ────────────────────────────────────
function buildTitleHTML(s, isSingle, footerHtml) {
  var periodText = isSingle
    ? 'Дата: ' + fmtDate(s.dateB) + (s.weekB ? ' (' + escHTML(s.weekB) + ')' : '')
    : fmtDate(s.dateA) + ' (' + escHTML(s.weekA) + ') → ' + fmtDate(s.dateB) + ' (' + escHTML(s.weekB) + ')';

  var logoHtml = s.logoBase64
    ? '<img src="' + s.logoBase64 + '" style="width:52px;height:52px;border-radius:10px;object-fit:cover;border:1px solid #e0e0e0" alt="logo">'
    : '<div class="logo-box">' + escHTML((s.quarryName || 'ЮРГ').slice(0, 3).toUpperCase()) + '</div>';

  var sigHtml = s.includeSignature
    ? '<div class="sig-row">' +
        '<div class="sig-block">' +
          '<div class="sig-role">Составил</div>' +
          '<div class="sig-name">' + escHTML(s.author || '—') + '</div>' +
          '<div class="sig-title-sub">' + escHTML(s.position || '') + '</div>' +
          '<div style="margin-top:16px;border-top:1px solid #ccc;width:160px;padding-top:4px;font-size:10px;color:#888">Подпись</div>' +
        '</div>' +
        '<div class="sig-block">' +
          '<div class="sig-role">Утвердил</div>' +
          '<div class="sig-name">' + escHTML(s.approverName || '—') + '</div>' +
          '<div style="margin-top:16px;border-top:1px solid #ccc;width:160px;padding-top:4px;font-size:10px;color:#888">Подпись</div>' +
        '</div>' +
      '</div>'
    : '';

  var ptsB = ReportState.ptsB || [];
  var qB = ptsB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); }, 0);
  var weekLabel = s.weekB || getWeekNumber(s.dateB) || '';

  return '<div class="page" id="page-title">' +
    '<div class="title-header">' +
      logoHtml +
      '<div class="title-company">' +
        '<div class="title-company-name">' + escHTML(s.quarryName || 'ЮРГ') + ' · ГИДРОГЕОЛОГИЧЕСКИЙ МОНИТОРИНГ</div>' +
        '<div class="title-company-sub">' + escHTML(s.objectName || '') + ' · Подземные воды</div>' +
      '</div>' +
      '<div class="title-doc-meta">' +
        '<strong>Документ №v' + (s.reportVersion || 1) + '</strong>' +
        fmtDate(s.dateReport) +
      '</div>' +
    '</div>' +
    '<div class="title-hr"></div>' +
    '<div class="title-label">Технический отчёт</div>' +
    '<div class="title-main">Отчёт по мониторингу подземных вод<br>' + escHTML(s.quarryName || 'ЮРГ') + (s.objectName ? ' · ' + escHTML(s.objectName) : '') + '</div>' +
    '<div style="display:flex;justify-content:center">' +
      '<div class="title-date-badge">' +
        '<svg width="14" height="14" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="#1a73e8" stroke-width="2"/><line x1="3" y1="9" x2="21" y2="9" stroke="#1a73e8" stroke-width="2"/><line x1="8" y1="2" x2="8" y2="6" stroke="#1a73e8" stroke-width="2"/><line x1="16" y1="2" x2="16" y2="6" stroke="#1a73e8" stroke-width="2"/></svg>' +
        periodText +
      '</div>' +
    '</div>' +
    '<div style="margin:24px auto;max-width:500px;padding:20px 28px;border:1px solid #e0e0e0;border-radius:12px;text-align:center;background:#f8faff">' +
      '<div style="font-size:11px;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-bottom:10px">Период отчёта</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">' +
        '<div><div style="font-size:20px;font-weight:800;color:#1a73e8">' + ptsB.length + '</div><div style="font-size:10px;color:#555">Точек</div></div>' +
        '<div><div style="font-size:20px;font-weight:800;color:#1a73e8">' + qB.toFixed(1) + '</div><div style="font-size:10px;color:#555">л/с суммарно</div></div>' +
        '<div><div style="font-size:20px;font-weight:800;color:#1a73e8">' + escHTML(String(weekLabel)) + '</div><div style="font-size:10px;color:#555">Неделя</div></div>' +
      '</div>' +
    '</div>' +
    sigHtml +
    '<div class="title-blue-bar"></div>' +
    (footerHtml || '') +
  '</div>';
}

// ── KPI-блок ──────────────────────────────────────────────
function buildKPIBlock(s, isSingle, qA, qB, dQ, ptsA, ptsB, dtsA, dtsB) {
  var dtQB = dtsB.reduce(function(a,d){ return a+(d.flowM3h||0); },0);
  var qVals = ptsB.map(function(p){ return parseFloat(p.flowRate)||0; }).filter(function(q){ return q>0; });
  var qMin = qVals.length ? Math.min.apply(null,qVals).toFixed(2) : '—';
  var qMax = qVals.length ? Math.max.apply(null,qVals).toFixed(2) : '—';
  var qSum = qVals.reduce(function(a,b){return a+b;},0);
  var qAvg = qVals.length ? (qSum/qVals.length).toFixed(2) : '—';
  var qStd = qVals.length >= 2
    ? Math.sqrt(qVals.reduce(function(a,q){ return a+Math.pow(q-qSum/qVals.length,2); },0)/qVals.length).toFixed(2)
    : '—';
  var activeB = ptsB.filter(function(p){ return p.status==='Активная'||p.status==='Паводковая'||p.status==='Перелив'; }).length;
  var newB    = ptsB.filter(function(p){ return p.status==='Новая'; }).length;
  var dryB    = ptsB.filter(function(p){ return p.status==='Пересохла'; }).length;
  var sub2 = !isSingle ? ((dQ>=0?'+':'')+dQ.toFixed(1)+' л/с к нед. А') : '';

  return '<div class="kpi-grid">' +
    '<div class="kpi-card">' +
      '<div class="kpi-val">' + ptsB.length + '</div>' +
      '<div class="kpi-lbl">Точек мониторинга</div>' +
      '<div class="kpi-sub">' + activeB + ' активных' + (newB?' · '+newB+' новых':'') + '</div>' +
    '</div>' +
    '<div class="kpi-card">' +
      '<div class="kpi-val">' + qB.toFixed(1) + '</div>' +
      '<div class="kpi-lbl">л/с Суммарный водоприток</div>' +
      (sub2 ? '<div class="kpi-sub">' + sub2 + '</div>' : '') +
    '</div>' +
    '<div class="kpi-card">' +
      '<div class="kpi-val">' + activeB + '</div>' +
      '<div class="kpi-lbl">Активных точек</div>' +
      '<div class="kpi-sub">' + (newB?newB+' Новая':'') + (dryB?(newB?' · ':'')+dryB+' Пересохла':'') + '</div>' +
    '</div>' +
    '<div class="kpi-card">' +
      '<div class="kpi-val" style="font-size:18px">' + qMin + ' / ' + qMax + '</div>' +
      '<div class="kpi-lbl">Q min / max, л/с</div>' +
      '<div class="kpi-sub">σ = ' + qStd + ' · avg = ' + qAvg + '</div>' +
    '</div>' +
  '</div>';
}

// ── Секция горизонтальных скважин ────────────────────────
function buildWellsSection(s, isSingle, secNum) {
  var wells = ReportState.allWells || (typeof WellsState !== 'undefined' ? WellsState.list : []);
  if (!wells.length) return '';
  var measMap = (typeof WellsState !== 'undefined') ? WellsState.measurements : {};

  // Последний замер на дату ≤ date
  function getMeasForDate(wellId, date) {
    var ms = (measMap[wellId] || []).filter(function(m) {
      return (m.measurementDate || '').slice(0, 10) <= date;
    });
    if (!ms.length) return null;
    ms.sort(function(a, b) {
      var da = (a.measurementDate || '').slice(0, 10);
      var db = (b.measurementDate || '').slice(0, 10);
      return da < db ? 1 : da > db ? -1 : 0;
    });
    return ms[0];
  }

  var wellData = wells.map(function(w) {
    return { w: w, mB: getMeasForDate(w.id, s.dateB), mA: isSingle ? null : getMeasForDate(w.id, s.dateA) };
  }).filter(function(d) { return d.mB !== null; });

  if (!wellData.length) return '';

  wellData.sort(function(a, b) {
    return (parseFloat((b.mB||{}).flowRate)||0) - (parseFloat((a.mB||{}).flowRate)||0);
  });

  var totalQB = wellData.reduce(function(acc,d){ return acc+(parseFloat((d.mB||{}).flowRate)||0); }, 0);
  var totalQA = isSingle ? 0 : wellData.reduce(function(acc,d){ return acc+(parseFloat((d.mA||{}).flowRate)||0); }, 0);
  var dQ = totalQB - totalQA;
  var activeCount = wellData.filter(function(d){ return d.w.status === 'Активная'; }).length;

  var kpiHtml = '<div class="kpi-grid" style="margin-bottom:14px">' +
    '<div class="kpi-card"><div class="kpi-val">' + wellData.length + '</div><div class="kpi-lbl">Скважин с данными</div></div>' +
    '<div class="kpi-card"><div class="kpi-val">' + activeCount + '</div><div class="kpi-lbl">Активных</div></div>' +
    '<div class="kpi-card"><div class="kpi-val">' + totalQB.toFixed(2) + ' <span style="font-size:12px">м³/ч</span></div>' +
      '<div class="kpi-lbl">Σ Q' + (isSingle ? '' : ' нед. Б') + '</div></div>' +
    '<div class="kpi-card"><div class="kpi-val">' + (totalQB/3.6).toFixed(2) + ' <span style="font-size:12px">л/с</span></div>' +
      '<div class="kpi-lbl">Σ Q, л/с</div></div>' +
    (!isSingle
      ? '<div class="kpi-card" style="' + (dQ>=0?'border-top:3px solid #d93025':'border-top:3px solid #188038') + '">' +
          '<div class="kpi-val" style="color:' + (dQ>=0?'#d93025':'#188038') + '">' + (dQ>=0?'▲+':'▼') + Math.abs(dQ).toFixed(2) + '</div>' +
          '<div class="kpi-lbl">Δ Q, м³/ч</div></div>'
      : '') +
  '</div>';

  var WELL_ST_CLR = { 'Активная':'#188038', 'Иссякает':'#f9ab00', 'Сухая':'#d93025' };
  var rows = wellData.map(function(d) {
    var w = d.w;
    var qb = parseFloat((d.mB||{}).flowRate) || 0;
    var qa = (!isSingle && d.mA) ? parseFloat(d.mA.flowRate) || 0 : null;
    var delta = qa !== null ? qb - qa : null;
    var measDate = ((d.mB||{}).measurementDate || '').slice(0, 10);
    var isExact = measDate === s.dateB;
    return '<tr>' +
      '<td><b>' + escAttr(w.name || '—') + '</b></td>' +
      '<td>' + escAttr(w.domain || '—') + '</td>' +
      '<td>' + escAttr(w.quarrySection || '—') + '</td>' +
      '<td style="color:' + (WELL_ST_CLR[w.status]||'#888') + ';font-weight:600">' + escAttr(w.status||'—') + '</td>' +
      '<td style="text-align:right">' + (w.depth != null ? w.depth.toFixed(1) + ' м' : '—') + '</td>' +
      (!isSingle ? '<td style="text-align:right">' + (qa !== null ? qa.toFixed(2) : '—') + '</td>' : '') +
      '<td style="text-align:right;font-weight:700;color:#1a73e8">' + qb.toFixed(2) + '</td>' +
      (!isSingle
        ? '<td style="color:' + (delta!==null?(delta>=0?'#d93025':'#188038'):'') + ';font-weight:600">' +
            (delta!==null ? (delta>=0?'▲+':'▼') + Math.abs(delta).toFixed(2) : '—') + '</td>'
        : '') +
      '<td style="text-align:right;color:' + (isExact?'#555':'#f9ab00') + ';font-size:10px">' +
        fmtDate(measDate) + (isExact ? '' : ' ↑') + '</td>' +
    '</tr>';
  }).join('');

  // Q bar chart per well
  var maxQbar = wellData.reduce(function(m,d){ return Math.max(m, parseFloat((d.mB||{}).flowRate)||0); }, 0) || 1;
  var WELL_STATUS_CLR = { 'Активная':'#188038','Иссякает':'#f9ab00','Сухая':'#d93025' };
  var wellBarsHtml = '<div class="sec-sub" style="margin-top:14px">Q скважин — визуализация</div>' +
    '<div style="display:flex;flex-direction:column;gap:5px;margin-bottom:14px">' +
    wellData.slice(0, 12).map(function(d) {
      var w = d.w;
      var qb = parseFloat((d.mB||{}).flowRate) || 0;
      var qa = (!isSingle && d.mA) ? parseFloat(d.mA.flowRate) || 0 : null;
      var delta = qa !== null ? qb - qa : null;
      var bw = Math.round(qb / maxQbar * 100);
      var clr = WELL_STATUS_CLR[w.status] || '#888';
      var dTxt = delta !== null
        ? ' <span style="font-size:9px;color:' + (delta>=0?'#d93025':'#188038') + ';font-weight:600">' +
            (delta>=0?'▲+':'▼') + Math.abs(delta).toFixed(2) + '</span>'
        : '';
      return '<div style="display:grid;grid-template-columns:120px 1fr 80px;gap:8px;align-items:center">' +
        '<div style="font-size:11px;font-weight:600;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(w.name) + '">' +
          '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + clr + ';margin-right:4px;vertical-align:middle"></span>' +
          escAttr(w.name) + '</div>' +
        '<div style="background:#f0f0f0;height:14px;border-radius:3px;overflow:hidden">' +
          '<div style="width:' + bw + '%;height:100%;background:' + clr + ';border-radius:3px"></div></div>' +
        '<div style="font-size:11px;font-weight:700;text-align:right;white-space:nowrap">' +
          qb.toFixed(2) + ' м³/ч' + dTxt + '</div>' +
      '</div>';
    }).join('') + '</div>';

  // Domain breakdown for wells
  var domainMap = {};
  wellData.forEach(function(d) {
    var dom = d.w.domain || '—';
    if (!domainMap[dom]) domainMap[dom] = { count:0, q:0 };
    domainMap[dom].count++;
    domainMap[dom].q += parseFloat((d.mB||{}).flowRate) || 0;
  });
  var domKeys = Object.keys(domainMap).sort(function(a,b){ return domainMap[b].q - domainMap[a].q; });
  var domainHtml = '';
  if (domKeys.length > 1) {
    var domRows = domKeys.map(function(dom) {
      var d = domainMap[dom];
      var pct = totalQB > 0 ? (d.q / totalQB * 100).toFixed(1) : '0.0';
      return '<tr><td><b>' + escAttr(dom) + '</b></td><td style="text-align:center">' + d.count + '</td>' +
        '<td style="text-align:right;font-weight:700;color:#1a73e8">' + d.q.toFixed(2) + '</td>' +
        '<td style="text-align:right">' + pct + '%</td></tr>';
    }).join('');
    domainHtml = '<div class="sec-sub">По доменам</div>' +
      '<table style="font-size:11px;margin-bottom:14px"><thead><tr>' +
        '<th>Домен</th><th style="text-align:center">Скважин</th>' +
        '<th style="text-align:right">Q, м³/ч</th><th style="text-align:right">%</th>' +
      '</tr></thead><tbody>' + domRows + '</tbody></table>';
  }

  // Return array of [page1_content, page2_content?] to allow caller to build multiple pages
  var page1 = '<div class="sec-head"><span class="sec-num">' + secNum + '</span> Горизонтальные скважины</div>' +
    kpiHtml +
    '<table><thead><tr>' +
      '<th>Скважина</th><th>Домен</th><th>Участок</th><th>Статус</th>' +
      '<th style="text-align:right">Глубина</th>' +
      (!isSingle ? '<th style="text-align:right">Q нед. А, м³/ч</th>' : '') +
      '<th style="text-align:right">Q' + (isSingle ? '' : ' нед. Б') + ', м³/ч</th>' +
      (!isSingle ? '<th>Δ, м³/ч</th>' : '') +
      '<th style="text-align:right">Дата замера</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>' +
    '<div style="font-size:10px;color:#aaa;margin-top:2px;margin-bottom:14px">↑ — ближайший замер до выбранной даты</div>';
  var wellsSvgHtml = '';
  var wellsMapMaxH = (s.orientation === 'landscape' ? 794 - 36 - 48 - 36 - 56 : 1123 - 48 - 60 - 36 - 56) + 'px';
  var wellsSchemeUrl = ReportState.wellsMapSvg ||
    ((ReportState.mapImgs||{}).imgB) ||
    ((ReportState.mapImgs||{}).imgA) || null;
  if (wellsSchemeUrl) {
    wellsSvgHtml = '<div class="sec-sub" style="margin-bottom:8px">Схема расположения скважин</div>' +
      '<div style="text-align:center;margin-bottom:14px">' +
        '<img src="' + wellsSchemeUrl + '" alt="Схема скважин" ' +
          'style="max-width:100%;max-height:' + wellsMapMaxH + ';height:auto;object-fit:contain;border:1px solid #e0e0e0;border-radius:4px">' +
      '</div>' +
      (ReportState.wellsMapSvg ? '' :
        '<div style="font-size:10px;color:#aaa;text-align:center;margin-top:-8px">* Схема скважин не захвачена — отображена общая схема карьера.<br>' +
        'Для захвата схемы скважин откройте вкладку «Скважины» перед генерацией отчёта.</div>');
  }
  var page2 = '<div class="sec-head" style="font-size:10px"><span class="sec-num" style="font-size:8px">⊛</span> Горизонтальные скважины — продолжение</div>' +
    wellBarsHtml + domainHtml;
  if (wellsSvgHtml) {
    var page3 = '<div class="sec-head" style="font-size:10px"><span class="sec-num" style="font-size:8px">⊛</span> Схема расположения скважин</div>' +
      wellsSvgHtml;
    return [page1, page2, page3];
  }
  return [page1, page2];
}

// ── Горизонтальный бар-чарт по доменам ───────────────────
function buildDomainBarsChart(ptsA, ptsB, isSingle) {
  var domenSet = {}, domenKeys = [];
  ptsA.concat(ptsB).forEach(function(p) {
    var d = p.domain || p.domen || '—';
    if (!domenSet[d]) { domenSet[d] = 1; domenKeys.push(d); }
  });
  domenKeys.sort();
  if (!domenKeys.length) return '';

  var rows = domenKeys.map(function(dom) {
    var dA = ptsA.filter(function(p){ return (p.domain||p.domen||'—') === dom; });
    var dB = ptsB.filter(function(p){ return (p.domain||p.domen||'—') === dom; });
    var qDA = dA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); }, 0);
    var qDB = dB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); }, 0);
    return { dom: dom, qA: qDA, qB: qDB, nB: dB.length, delta: qDB - qDA };
  });

  var maxQ = Math.max.apply(null, rows.map(function(r){ return Math.max(r.qA, r.qB); })) || 1;

  var barsHtml = rows.map(function(r) {
    var wB = Math.round(r.qB / maxQ * 100);
    var wA = Math.round(r.qA / maxQ * 100);
    var isUp = r.delta > 0.001, isDown = r.delta < -0.001;
    var dColor = isUp ? '#d93025' : isDown ? '#188038' : '#888';
    var dTxt = Math.abs(r.delta) > 0.001 ? (isUp ? '▲+' : '▼') + Math.abs(r.delta).toFixed(1) : '→';
    var track = isSingle
      ? '<div style="height:20px;background:#f1f5f9;border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;width:' + wB + '%;background:#1a73e8;border-radius:3px;display:flex;align-items:center;padding-left:' + (wB > 15 ? '8px' : '2px') + '">' +
          (wB > 12 ? '<span style="font-size:9px;font-weight:700;color:#fff;white-space:nowrap">' + r.qB.toFixed(1) + ' л/с</span>' : '') +
          '</div></div>'
      : '<div>' +
          '<div style="height:7px;background:#f1f5f9;border-radius:2px;overflow:hidden;margin-bottom:3px">' +
            '<div style="height:100%;width:' + wA + '%;background:#93c5fd;border-radius:2px"></div></div>' +
          '<div style="height:13px;background:#f1f5f9;border-radius:2px;overflow:hidden">' +
            '<div style="height:100%;width:' + wB + '%;background:#1a73e8;border-radius:2px;display:flex;align-items:center;padding-left:' + (wB > 15 ? '6px' : '2px') + '">' +
            (wB > 12 ? '<span style="font-size:9px;font-weight:700;color:#fff;white-space:nowrap">' + r.qB.toFixed(1) + '</span>' : '') +
            '</div></div></div>';
    return '<div style="display:grid;grid-template-columns:110px 1fr 90px;gap:10px;align-items:center">' +
      '<div style="font-size:11px;color:#334155;font-weight:600;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' + escAttr(r.dom) + '</div>' +
      '<div>' + track + '</div>' +
      '<div style="text-align:right">' +
        '<div style="font-size:11px;font-weight:700;color:#1a73e8;white-space:nowrap">' + r.qB.toFixed(1) + ' л/с</div>' +
        (!isSingle
          ? '<div style="font-size:10px;font-weight:700;color:' + dColor + ';white-space:nowrap">' + dTxt + '</div>'
          : '<div style="font-size:9px;color:#94a3b8">' + r.nB + ' тч.</div>') +
      '</div>' +
    '</div>';
  }).join('');

  var legend = isSingle ? '' :
    '<div style="display:flex;gap:16px;font-size:9px;color:#94a3b8;margin-bottom:8px">' +
      '<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:5px;background:#93c5fd;border-radius:1px"></span>Нед. А</span>' +
      '<span style="display:flex;align-items:center;gap:4px"><span style="display:inline-block;width:10px;height:10px;background:#1a73e8;border-radius:1px"></span>Нед. Б</span>' +
    '</div>';

  return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-top:14px">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:10px">Σ Q по доменам, л/с</div>' +
    legend +
    '<div style="display:flex;flex-direction:column;gap:8px">' + barsHtml + '</div>' +
  '</div>';
}

// ── Топ-5 изменений Q (только compare) ──────────────────
function buildTopChangesChart(ptsA, ptsB) {
  var changes = [];
  ptsB.forEach(function(pb) {
    var pa = null;
    for (var i = 0; i < ptsA.length; i++) { if (ptsA[i].pointNumber === pb.pointNumber) { pa = ptsA[i]; break; } }
    if (!pa) return;
    var qa = parseFloat(pa.flowRate) || 0;
    var qb = parseFloat(pb.flowRate) || 0;
    var delta = qb - qa;
    if (Math.abs(delta) < 0.001) return;
    changes.push({ num: pb.pointNumber, domain: pb.domain||pb.domen||'—', qa: qa, qb: qb, delta: delta });
  });
  if (!changes.length) return '';
  changes.sort(function(a, b){ return Math.abs(b.delta) - Math.abs(a.delta); });
  var top = changes.slice(0, 5);
  var maxAbs = Math.max.apply(null, top.map(function(r){ return Math.abs(r.delta); })) || 1;

  var html = top.map(function(r, i) {
    var w = Math.round(Math.abs(r.delta) / maxAbs * 100);
    var isUp = r.delta > 0;
    var color = isUp ? '#d93025' : '#188038';
    var pct = r.qa > 0 ? (Math.abs(r.delta) / r.qa * 100).toFixed(0) + '%' : '—';
    return '<div style="display:grid;grid-template-columns:28px 1fr 76px 44px;gap:8px;align-items:center;margin-bottom:6px">' +
      '<div style="width:24px;height:24px;border-radius:4px;background:#0f172a;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:800;font-size:11px;flex-shrink:0">' + (i+1) + '</div>' +
      '<div>' +
        '<div style="font-size:10px;font-weight:600;color:#334155;margin-bottom:3px">#' + escAttr(String(r.num)) + ' · ' + escAttr(r.domain) + '</div>' +
        '<div style="height:12px;background:#f1f5f9;border-radius:3px;overflow:hidden">' +
          '<div style="height:100%;width:' + w + '%;background:' + color + ';border-radius:3px"></div></div>' +
      '</div>' +
      '<div style="text-align:right;font-size:11px;font-weight:700;color:' + color + ';white-space:nowrap">' + (isUp?'▲+':'▼') + Math.abs(r.delta).toFixed(2) + ' л/с</div>' +
      '<div style="text-align:right;font-size:10px;color:#94a3b8">' + pct + '</div>' +
    '</div>';
  }).join('');

  return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-top:14px">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:10px">Топ-5 изменений Q (нед. А → Б)</div>' +
    html +
  '</div>';
}

// ── Динамика Σ Q по неделям (из истории точек) ───────────
function buildSummaryTimeline(s) {
  var ptH = ReportState.ptHistory || {};
  var byDate = {};
  Object.keys(ptH).forEach(function(num) {
    (ptH[num] || []).forEach(function(e) {
      var d = normDateISO(e.monitoringDate);
      var q = parseFloat(e.flowRate);
      if (!d || isNaN(q)) return;
      byDate[d] = (byDate[d] || 0) + q;
    });
  });
  var allDates = Object.keys(byDate).sort();
  if (allDates.length < 3) return '';
  if (allDates.length > 12) allDates = allDates.slice(allDates.length - 12);
  var data = allDates.map(function(d) { return { date: d, q: byDate[d] }; });
  var n = data.length;

  var markerB = s.dateB || '';
  var markerA = s.reportMode !== 'single' ? (s.dateA || '') : '';

  var W = 680, CH = 90, DH = 38, H = CH + DH;
  var PL = 40, PR = 12, PT = 12, PB = 2;
  var iW = W - PL - PR, iH = CH - PT - PB;

  var minQ = Math.min.apply(null, data.map(function(d){ return d.q; }));
  var maxQ = Math.max.apply(null, data.map(function(d){ return d.q; }));
  if (maxQ === minQ) { minQ = Math.max(0, minQ - 1); maxQ += 1; }
  var qRange = maxQ - minQ;

  function sx(i) { return PL + i / (n - 1) * iW; }
  function sy(q) { return PT + iH - (q - minQ) / qRange * iH; }

  var polyline = data.map(function(d,i){ return sx(i).toFixed(1) + ',' + sy(d.q).toFixed(1); }).join(' ');
  var area = polyline + ' ' + (PL+iW).toFixed(1) + ',' + (PT+iH) + ' ' + PL + ',' + (PT+iH);

  var yAxis = '';
  for (var yi = 0; yi <= 3; yi++) {
    var qv = minQ + qRange * yi / 3;
    var yp = sy(qv).toFixed(1);
    yAxis += '<line x1="' + (PL-3) + '" y1="' + yp + '" x2="' + (PL+iW) + '" y2="' + yp + '" stroke="#f0f0f0" stroke-width="1"/>' +
      '<text x="' + (PL-5) + '" y="' + yp + '" text-anchor="end" font-size="9" dominant-baseline="middle" fill="#bbb">' + qv.toFixed(0) + '</text>';
  }

  var dots = '', dateLabels = '', markers = '';
  data.forEach(function(d, i) {
    var cx = sx(i), cy = sy(d.q);
    var isMkB = d.date === markerB, isMkA = !!(markerA && d.date === markerA);
    var fill = isMkB ? '#1a73e8' : isMkA ? '#888' : '#fff';
    var stroke = isMkB ? '#1a73e8' : isMkA ? '#888' : '#1a73e8';
    var r = (isMkA || isMkB) ? 5 : 3;
    dots += '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="' + r + '" fill="' + fill + '" stroke="' + stroke + '" stroke-width="1.5"/>';
    if (isMkA) markers += '<line x1="' + cx.toFixed(1) + '" y1="' + PT + '" x2="' + cx.toFixed(1) + '" y2="' + (PT+iH) + '" stroke="#aaa" stroke-width="1" stroke-dasharray="3,2"/>';
    if (isMkB) markers += '<line x1="' + cx.toFixed(1) + '" y1="' + PT + '" x2="' + cx.toFixed(1) + '" y2="' + (PT+iH) + '" stroke="#1a73e8" stroke-width="1.5" stroke-dasharray="3,2"/>';
    var dp = d.date.split('-');
    var lbl = dp.length === 3 ? dp[2] + '.' + dp[1] : d.date.slice(5);
    var lColor = isMkB ? '#1a73e8' : isMkA ? '#666' : '#aaa';
    var lSize = (isMkA || isMkB) ? 9 : 8;
    dateLabels += '<text transform="rotate(-38,' + cx.toFixed(1) + ',' + CH + ')" x="' + cx.toFixed(1) + '" y="' + CH + '" text-anchor="end" font-size="' + lSize + '" fill="' + lColor + '">' + lbl + '</text>';
  });

  return '<div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px;margin-top:14px">' +
    '<div style="font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#94a3b8;margin-bottom:6px">Σ Q (все точки), л/с — динамика по неделям</div>' +
    '<svg viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '" style="width:100%;display:block;overflow:visible">' +
      '<line x1="' + PL + '" y1="' + PT + '" x2="' + PL + '" y2="' + (PT+iH) + '" stroke="#e8e8e8" stroke-width="1"/>' +
      '<line x1="' + PL + '" y1="' + (PT+iH) + '" x2="' + (PL+iW) + '" y2="' + (PT+iH) + '" stroke="#e8e8e8" stroke-width="1"/>' +
      yAxis + markers +
      '<polygon points="' + area + '" fill="#1a73e8" opacity=".07"/>' +
      '<polyline points="' + polyline + '" fill="none" stroke="#1a73e8" stroke-width="2" stroke-linejoin="round"/>' +
      dots + dateLabels +
    '</svg>' +
  '</div>';
}

// ── Аналитика и оценка рисков ─────────────────────────────
// ── Матрица Домен × Статус ────────────────────────────────
function buildDomainStatusMatrix(pts) {
  if (!pts.length) return '';
  var STATUSES_SHOW = ['Активная','Паводковая','Иссякает','Пересохла','Новая','Перелив'];
  var sClrs = { 'Активная':'#34a853','Паводковая':'#4285f4','Иссякает':'#f9ab00','Пересохла':'#ea4335','Новая':'#9e9e9e','Перелив':'#00bcd4' };

  var domains = [], domSet = {};
  pts.forEach(function(p) {
    var d = p.domain || p.domen || '—';
    if (!domSet[d]) { domSet[d] = 1; domains.push(d); }
  });
  domains.sort();

  var mx = {}, dQ = {}, dTotal = {}, sTot = {};
  domains.forEach(function(d) { mx[d] = {}; dQ[d] = 0; dTotal[d] = 0; });
  pts.forEach(function(p) {
    var d = p.domain || p.domen || '—', st = p.status || '—';
    mx[d][st] = (mx[d][st] || 0) + 1; dTotal[d]++;
    var q = parseFloat(p.flowRate); if (!isNaN(q) && q > 0) dQ[d] += q;
    sTot[st] = (sTot[st] || 0) + 1;
  });

  var maxCell = 0;
  domains.forEach(function(d) {
    STATUSES_SHOW.forEach(function(st) { if ((mx[d][st]||0) > maxCell) maxCell = mx[d][st]; });
  });

  function cellStyle(v) {
    if (!v) return '';
    var a = Math.round(v / (maxCell||1) * 70) / 100;
    return 'background:rgba(26,115,232,' + a + ');color:' + (a > 0.38 ? '#fff' : '#1a1a2e') + ';font-weight:700;text-align:center';
  }

  var hdr = '<tr><th>Домен</th>' +
    STATUSES_SHOW.map(function(st) {
      return '<th style="color:' + (sClrs[st]||'#555') + ';text-align:center">' + escHTML(st.slice(0,4)) + '.</th>';
    }).join('') + '<th style="text-align:center">∑</th><th style="text-align:right">Q л/с</th></tr>';

  var rows = domains.map(function(d) {
    return '<tr><td><b>' + escAttr(d) + '</b></td>' +
      STATUSES_SHOW.map(function(st) {
        var v = mx[d][st] || 0;
        return '<td style="' + cellStyle(v) + '">' + (v || '—') + '</td>';
      }).join('') +
      '<td style="text-align:center;font-weight:700">' + dTotal[d] + '</td>' +
      '<td style="text-align:right;color:#1a73e8;font-weight:700">' + dQ[d].toFixed(2) + '</td></tr>';
  }).join('');

  var totalQ = pts.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); }, 0);
  var foot = '<tr style="background:#f1f3f4"><td><b>∑</b></td>' +
    STATUSES_SHOW.map(function(st) {
      return '<td style="text-align:center"><b>' + (sTot[st]||0) + '</b></td>';
    }).join('') +
    '<td style="text-align:center"><b>' + pts.length + '</b></td>' +
    '<td style="text-align:right"><b>' + totalQ.toFixed(2) + '</b></td></tr>';

  return '<div class="sec-sub">Матрица: Домен × Статус</div>' +
    '<div style="overflow-x:auto;margin-bottom:16px"><table style="font-size:11px"><thead>' +
    hdr + '</thead><tbody>' + rows + foot + '</tbody></table></div>';
}

// ── Распределение по бортам ───────────────────────────────
function buildWallDistribution(pts) {
  var WALL_DEFS = [
    { key:'Северный',         clr:'#22d3ee' }, { key:'Северо-восточный', clr:'#7ecfff' },
    { key:'Восточный',        clr:'#ea4335' }, { key:'Юго-восточный',    clr:'#ff7961' },
    { key:'Южный',            clr:'#f9ab00' }, { key:'Юго-западный',     clr:'#ffcc57' },
    { key:'Западный',         clr:'#34a853' }, { key:'Северо-западный',  clr:'#85e89d' },
  ];
  var wStats = {}, totalQ = 0, other = { count:0, q:0 };
  WALL_DEFS.forEach(function(w) { wStats[w.key] = { count:0, q:0 }; });
  pts.forEach(function(p) {
    var q = parseFloat(p.flowRate) || 0; totalQ += q;
    var wd = WALL_DEFS.find(function(w) { return w.key === p.wall; });
    if (wd) { wStats[p.wall].count++; wStats[p.wall].q += q; }
    else     { other.count++; other.q += q; }
  });

  var withData = WALL_DEFS.filter(function(w) { return wStats[w.key].count > 0; });
  if (!withData.length) return '';
  withData.sort(function(a,b) { return wStats[b.key].q - wStats[a.key].q; });
  var maxQ = wStats[withData[0].key].q || 1;

  function barRow(label, clr, st, isOther) {
    var pct = totalQ > 0 ? (st.q / totalQ * 100).toFixed(1) : '0.0';
    var bw = Math.round(st.q / maxQ * 100);
    return '<tr' + (isOther ? ' style="color:#aaa"' : '') + '>' +
      '<td>' +
        '<span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:' + clr + ';margin-right:6px;vertical-align:middle"></span>' +
        '<b>' + escAttr(label) + '</b></td>' +
      '<td style="text-align:center">' + st.count + '</td>' +
      '<td style="text-align:right;font-weight:700;color:' + (isOther ? '#aaa' : '#1a73e8') + '">' + st.q.toFixed(2) + '</td>' +
      '<td style="text-align:right">' + pct + '%</td>' +
      '<td style="min-width:80px">' +
        '<div style="height:12px;background:#f0f0f0;border-radius:3px;overflow:hidden">' +
          '<div style="width:' + bw + '%;height:100%;background:' + clr + ';border-radius:3px"></div>' +
        '</div></td></tr>';
  }

  var rows = withData.map(function(w) { return barRow(w.key, w.clr, wStats[w.key], false); }).join('');
  if (other.q > 0) rows += barRow('Прочие / не указан', '#ccc', other, true);

  return '<div class="sec-sub">Распределение по бортам</div>' +
    '<table style="font-size:11px;margin-bottom:16px"><thead><tr>' +
      '<th>Борт</th><th style="text-align:center">Точек</th>' +
      '<th style="text-align:right">Q, л/с</th><th style="text-align:right">%</th><th>Диаграмма</th>' +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ── Дебиты по горизонтам (с барами) ──────────────────────
function buildHorizonQBars(pts, ptsA, isSingle) {
  var byH = {}, totalQ = 0;
  pts.forEach(function(p) {
    var h = (p.horizon && String(p.horizon).trim()) ? String(p.horizon).trim() : '—';
    if (!byH[h]) byH[h] = { count:0, q:0 };
    byH[h].count++;
    var q = parseFloat(p.flowRate);
    if (!isNaN(q) && q > 0) { byH[h].q += q; totalQ += q; }
  });
  var horizKeys = Object.keys(byH).sort(function(a,b) { return byH[b].q - byH[a].q; });
  if (!horizKeys.length) return '';
  var maxQ = byH[horizKeys[0]].q || 1;

  var byHA = {};
  if (!isSingle && ptsA && ptsA.length) {
    ptsA.forEach(function(p) {
      var h = (p.horizon && String(p.horizon).trim()) ? String(p.horizon).trim() : '—';
      if (!byHA[h]) byHA[h] = { q:0 };
      var q = parseFloat(p.flowRate);
      if (!isNaN(q) && q > 0) byHA[h].q += q;
    });
  }

  var rows = horizKeys.map(function(h) {
    var d = byH[h];
    var pct = totalQ > 0 ? (d.q / totalQ * 100).toFixed(1) : '0.0';
    var bw = Math.round(d.q / maxQ * 100);
    var prevQ = (byHA[h]||{}).q || 0;
    var diff = (!isSingle && prevQ > 0) ? (d.q - prevQ) / prevQ * 100 : null;
    var dClr = diff !== null ? (diff > 5 ? '#d93025' : diff < -5 ? '#188038' : '#888') : '';
    var dTxt = diff !== null
      ? '<span style="color:' + dClr + ';font-weight:700">' + (diff>5?'▲+':diff<-5?'▼':'→') + Math.abs(diff).toFixed(0) + '%</span>'
      : '';
    return '<tr><td><b>' + escAttr(h) + '</b></td>' +
      '<td style="text-align:center">' + d.count + '</td>' +
      '<td style="min-width:100px">' +
        '<div style="height:12px;background:#e8f0fe;border-radius:3px;overflow:hidden">' +
          '<div style="width:' + bw + '%;height:100%;background:#1a73e8;border-radius:3px"></div>' +
        '</div></td>' +
      '<td style="text-align:right;font-weight:700;color:#1a73e8">' + d.q.toFixed(2) + '</td>' +
      '<td style="text-align:right">' + pct + '%</td>' +
      (!isSingle ? '<td style="text-align:right">' + dTxt + '</td>' : '') +
    '</tr>';
  }).join('');

  return '<div class="sec-sub">Дебиты по горизонтам</div>' +
    '<table style="font-size:11px;margin-bottom:16px"><thead><tr>' +
      '<th>Горизонт</th><th style="text-align:center">Точек</th><th>Диаграмма Q</th>' +
      '<th style="text-align:right">Q, л/с</th><th style="text-align:right">%</th>' +
      (!isSingle ? '<th style="text-align:right">Δ к нед. А</th>' : '') +
    '</tr></thead><tbody>' + rows + '</tbody></table>';
}

// ── Анализ скважин (блок для аналитики) ──────────────────
function buildWellAnalysisBlock(s, isSingle) {
  var wells = ReportState.allWells || (typeof WellsState !== 'undefined' ? WellsState.list : []);
  if (!wells.length) return '';
  var measMap = (typeof WellsState !== 'undefined') ? WellsState.measurements : {};

  function latestOnDate(wellId, date) {
    var ms = (measMap[wellId]||[]).filter(function(m){ return (m.measurementDate||'').slice(0,10) <= date; });
    if (!ms.length) return null;
    return ms.reduce(function(a,b){ return (a.measurementDate||'') > (b.measurementDate||'') ? a : b; });
  }

  var wd = wells.map(function(w) {
    var mB = latestOnDate(w.id, s.dateB);
    var mA = isSingle ? null : latestOnDate(w.id, s.dateA);
    return { w:w, mB:mB, mA:mA, qB:parseFloat((mB||{}).flowRate)||0, qA:mA?parseFloat(mA.flowRate)||0:0 };
  }).filter(function(d){ return d.mB !== null; });
  if (!wd.length) return '';

  var activeCount = wells.filter(function(w){ return w.status==='Активная'; }).length;
  var dryCount    = wells.filter(function(w){ return w.status==='Сухая'; }).length;
  var totalQB     = wd.reduce(function(a,d){ return a+d.qB; }, 0);
  var totalQA     = wd.reduce(function(a,d){ return a+d.qA; }, 0);
  var dQ          = totalQB - totalQA;

  var kpiHtml = '<div class="kpi-grid" style="margin-bottom:12px">' +
    '<div class="kpi-card"><div class="kpi-val">' + wells.length + '</div>' +
      '<div class="kpi-lbl">Скважин всего</div>' +
      '<div class="kpi-sub">' + activeCount + ' акт. · ' + dryCount + ' сухих</div></div>' +
    '<div class="kpi-card"><div class="kpi-val">' + totalQB.toFixed(2) + '<span style="font-size:12px"> м³/ч</span></div>' +
      '<div class="kpi-lbl">Σ Q скважин</div><div class="kpi-sub">' + (totalQB/3.6).toFixed(2) + ' л/с</div></div>' +
    (!isSingle && totalQA > 0
      ? '<div class="kpi-card" style="' + (dQ>=0?'border-top:3px solid #d93025':'border-top:3px solid #188038') + '">' +
          '<div class="kpi-val" style="color:' + (dQ>=0?'#d93025':'#188038') + '">' + (dQ>=0?'▲+':'▼') + Math.abs(dQ).toFixed(2) + '</div>' +
          '<div class="kpi-lbl">Δ Q нед. А→Б, м³/ч</div></div>'
      : '') +
  '</div>';

  wd.sort(function(a,b){ return b.qB - a.qB; });
  var maxWQ = wd[0].qB || 1;
  var WELL_ST_CLR = { 'Активная':'#188038','Иссякает':'#f9ab00','Сухая':'#d93025' };

  var barsHtml = wd.slice(0, 8).map(function(d) {
    var w = d.w, bw = Math.round(d.qB / maxWQ * 100);
    var clr = WELL_ST_CLR[w.status] || '#888';
    var delta = !isSingle && d.mA ? d.qB - d.qA : null;
    var dTxt = delta !== null
      ? ' <span style="font-size:10px;color:' + (delta>=0?'#d93025':'#188038') + ';font-weight:600">' +
          (delta>=0?'▲+':'▼') + Math.abs(delta).toFixed(2) + '</span>'
      : '';
    return '<div style="display:grid;grid-template-columns:110px 1fr 72px;gap:8px;align-items:center;margin-bottom:5px">' +
      '<div style="font-size:11px;font-weight:600;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + escAttr(w.name) + '">' +
        escAttr(w.name) + '</div>' +
      '<div style="background:#f0f0f0;height:16px;border-radius:3px;overflow:hidden">' +
        '<div style="width:' + bw + '%;height:100%;background:' + clr + ';border-radius:3px"></div></div>' +
      '<div style="font-size:11px;text-align:right;font-weight:700;white-space:nowrap">' +
        d.qB.toFixed(2) + ' м³/ч' + dTxt + '</div>' +
    '</div>';
  }).join('');

  return '<div class="sec-sub">Анализ скважин</div>' + kpiHtml + barsHtml +
    (wd.length > 8 ? '<div style="font-size:10px;color:#aaa;margin-top:6px">Показаны топ-8 из ' + wd.length + ' скважин с данными</div>' : '');
}

function buildAnalyticsContent(s, ptsA, ptsB, isSingle, ai) {
  var STATUS_COLORS = { 'Новая':'#4f8dff','Активная':'#39d98a','Иссякает':'#f3bf4a','Пересохла':'#ff6b6b','Паводковая':'#a78bfa','Перелив':'#38bdf8' };

  // Аномалии: точки с изменением ≥ 30% (только compare)
  var anomaliesHtml = '';
  if (!isSingle && ptsA.length && ptsB.length) {
    var anomList = [];
    ptsB.forEach(function(pb) {
      var pa = null;
      for (var i = 0; i < ptsA.length; i++) { if (ptsA[i].pointNumber === pb.pointNumber) { pa = ptsA[i]; break; } }
      if (!pa) return;
      var qa = parseFloat(pa.flowRate) || 0;
      var qb = parseFloat(pb.flowRate) || 0;
      var delta = qb - qa;
      var pct = qa > 0 ? delta / qa * 100 : (qb > 0 ? 100 : 0);
      if (Math.abs(pct) < 30) return;
      anomList.push({ num: pb.pointNumber, domain: pb.domain||pb.domen||'—', status: pb.status||'—', qa: qa, qb: qb, delta: delta, pct: pct });
    });
    if (anomList.length) {
      anomList.sort(function(a, b){ return Math.abs(b.pct) - Math.abs(a.pct); });
      var anomRows = anomList.map(function(r) {
        var isUp = r.delta > 0;
        var risk = isUp ? (r.pct > 100 ? '🔴 Критично' : '🟡 Рост') : '🟢 Снижение';
        return '<tr style="background:' + (isUp ? '#fff8e1' : '#f0fef4') + '">' +
          '<td><b>#' + escAttr(String(r.num)) + '</b></td>' +
          '<td>' + escAttr(r.domain) + '</td>' +
          '<td>' + escAttr(r.status) + '</td>' +
          '<td style="text-align:right">' + r.qa.toFixed(2) + '</td>' +
          '<td style="text-align:right;font-weight:700;color:#1a73e8">' + r.qb.toFixed(2) + '</td>' +
          '<td style="text-align:right;font-weight:700;color:' + (isUp?'#d93025':'#188038') + '">' + (isUp?'▲+':'▼') + Math.abs(r.delta).toFixed(2) + '</td>' +
          '<td style="text-align:right;color:' + (isUp?'#d93025':'#188038') + '">' + (isUp?'+':'') + r.pct.toFixed(0) + '%</td>' +
          '<td>' + risk + '</td>' +
        '</tr>';
      }).join('');
      anomaliesHtml = '<div class="sec-sub">Аномалии — изменение Q ≥ 30%</div>' +
        '<table style="margin-bottom:14px"><thead><tr>' +
          '<th>№</th><th>Домен</th><th>Статус</th>' +
          '<th style="text-align:right">Q нед. А, л/с</th><th style="text-align:right">Q нед. Б, л/с</th>' +
          '<th style="text-align:right">Δ л/с</th><th style="text-align:right">Δ %</th><th>Оценка</th>' +
        '</tr></thead><tbody>' + anomRows + '</tbody></table>';
    }
  }

  // Статистика Q по точкам нед. Б
  var statsHtml = '';
  var qVals = ptsB.map(function(p){ return parseFloat(p.flowRate)||0; }).filter(function(q){ return q > 0; });
  if (qVals.length >= 2) {
    var qSum = qVals.reduce(function(a,b){ return a+b; }, 0);
    var qAvg = qSum / qVals.length;
    var qMin = Math.min.apply(null, qVals);
    var qMax = Math.max.apply(null, qVals);
    var qStd = Math.sqrt(qVals.reduce(function(a,q){ return a + Math.pow(q-qAvg,2); }, 0) / qVals.length);
    var byStatus = {};
    ptsB.forEach(function(p){ var st = p.status||'—'; byStatus[st] = (byStatus[st]||0)+1; });
    var statusChips = Object.keys(byStatus).map(function(st) {
      return '<span style="display:inline-flex;align-items:center;gap:4px;margin:0 8px 4px 0;font-size:10px">' +
        '<span style="width:8px;height:8px;border-radius:50%;background:' + (STATUS_COLORS[st]||'#888') + ';flex-shrink:0"></span>' +
        '<b>' + byStatus[st] + '</b> ' + escAttr(st) + '</span>';
    }).join('');
    statsHtml = '<div class="sec-sub" style="margin-top:14px">Статистика Q ' + (isSingle ? '· ' + fmtDate(s.dateB) : '· нед. Б') + '</div>' +
      '<div class="kpi-grid" style="margin-bottom:10px">' +
        '<div class="kpi-card"><div class="kpi-val">' + qMin.toFixed(2) + '</div><div class="kpi-lbl">Min Q, л/с</div></div>' +
        '<div class="kpi-card"><div class="kpi-val">' + qMax.toFixed(2) + '</div><div class="kpi-lbl">Max Q, л/с</div></div>' +
        '<div class="kpi-card"><div class="kpi-val">' + qAvg.toFixed(2) + '</div><div class="kpi-lbl">Ср. Q, л/с</div></div>' +
        '<div class="kpi-card"><div class="kpi-val">' + qStd.toFixed(2) + '</div><div class="kpi-lbl">Ст. откл. σ</div></div>' +
      '</div>' +
      '<div style="margin-bottom:12px">' + statusChips + '</div>';
  }

  // AI-рекомендации
  var aiBlock = ai.recommendations
    ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.recommendations) + '</div>'
    : '';

  if (!anomaliesHtml && !statsHtml && !aiBlock) return '';

  return anomaliesHtml + statsHtml + aiBlock;
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
  var dQ = qB - qA;

  var STATUS_COLORS = { 'Новая':'#4285f4','Активная':'#34a853','Иссякает':'#f9ab00','Пересохла':'#ea4335','Паводковая':'#a78bfa','Перелив':'#38bdf8' };
  var INTENS_COLORS = { 'Слабая (капёж)':'#93c5fd','Умеренная':'#34a853','Сильная (поток)':'#f9ab00','Очень сильная':'#ea4335' };
  var STATUSES  = ['Новая','Активная','Иссякает','Пересохла','Паводковая','Перелив'];
  var INTENSITIES = ['Слабая (капёж)','Умеренная','Сильная (поток)','Очень сильная'];

  function countBy(pts, key) {
    var r = {};
    pts.forEach(function(p){ var v=p[key]||'—'; r[v]=(r[v]||0)+1; });
    return r;
  }

  var pageNum = 0;
  function footer() {
    pageNum++;
    return '<div class="page-footer">' +
      '<span>' + escHTML(s.quarryName||'ЮРГ') + ' · Мониторинг подземных вод · ' + fmtDate(s.dateReport) + '</span>' +
      '<span>v' + (s.reportVersion||1) + ' | Стр. ' + pageNum + '</span>' +
    '</div>';
  }

  // ── PAGE 1: Title ──
  var pages = [buildTitleHTML(s, isSingle, footer())];

  // ── PAGE 2: Summary ──
  var aiSummaryHtml = ai.error
    ? '<div class="rp-ai-text" style="border-left-color:#d93025"><span class="rp-ai-badge" style="background:#d93025">AI</span>⚠ ' + escHTML(ai.error) + '</div>'
    : ai.summary ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.summary) + '</div>' : '';

  var domenSet = {}, domenKeys = [];
  ptsA.concat(ptsB).forEach(function(p){ var d=p.domain||p.domen||'—'; if(!domenSet[d]){domenSet[d]=1;domenKeys.push(d);} });
  domenKeys.sort();

  var donutsHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:18px">' +
    '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:14px">' +
      '<div class="sec-sub" style="margin-top:0">Статус точек</div>' +
      buildDonutSVG(countBy(ptsB,'status'), STATUSES, STATUS_COLORS, ptsB.length) +
    '</div>' +
    '<div style="border:1px solid #e0e0e0;border-radius:8px;padding:14px">' +
      '<div class="sec-sub" style="margin-top:0">По горизонтам (Q, л/с)</div>' +
      buildHorizonTable(ptsB, '', '#1a73e8') +
    '</div>' +
  '</div>';

  var totalQ = ptsB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); }, 0);

  var byH = {};
  ptsB.forEach(function(p) {
    var h = (p.horizon && String(p.horizon).trim()) ? String(p.horizon).trim() : '—';
    if (!byH[h]) byH[h] = {count:0, total:0};
    byH[h].count++;
    var f = parseFloat(p.flowRate);
    if (!isNaN(f)) byH[h].total += f;
  });
  var horizKeys = Object.keys(byH).sort(function(a,b){ return (byH[b]||{total:0}).total - (byH[a]||{total:0}).total; });
  var horizRows = horizKeys.map(function(h) {
    var d = byH[h];
    var pct = totalQ > 0 ? (d.total/totalQ*100).toFixed(1) : '0.0';
    return '<tr><td><strong>' + escAttr(h) + '</strong></td><td>' + d.count + '</td>' +
      '<td><strong>' + d.total.toFixed(2) + '</strong></td><td>' + pct + '%</td></tr>';
  }).join('');

  var domenSummaryRows = domenKeys.map(function(dom) {
    var dPts = ptsB.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
    var dQdom = dPts.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); }, 0);
    var pct = totalQ > 0 ? (dQdom/totalQ*100).toFixed(1) : '0.0';
    return '<tr><td><strong>' + escAttr(dom) + '</strong></td><td>' + dPts.length + '</td>' +
      '<td><strong>' + dQdom.toFixed(2) + '</strong></td><td>' + pct + '%</td></tr>';
  }).join('');

  var summaryTablesHtml = '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
    '<div>' +
      '<div class="sec-sub">Сводка по горизонтам</div>' +
      '<table><thead><tr><th>Горизонт</th><th>Точек</th><th>Q, л/с</th><th>%</th></tr></thead><tbody>' +
      horizRows +
      '<tr style="background:#e8f0fe"><td><strong>Итого</strong></td><td><strong>' + ptsB.length + '</strong></td>' +
        '<td><strong>' + qB.toFixed(2) + '</strong></td><td>100%</td></tr>' +
      '</tbody></table>' +
    '</div>' +
    '<div>' +
      '<div class="sec-sub">Сводка по доменам</div>' +
      '<table><thead><tr><th>Домен</th><th>Точек</th><th>Q, л/с</th><th>%</th></tr></thead><tbody>' +
      domenSummaryRows +
      '<tr style="background:#e8f0fe"><td><strong>Итого</strong></td><td><strong>' + ptsB.length + '</strong></td>' +
        '<td><strong>' + qB.toFixed(2) + '</strong></td><td>100%</td></tr>' +
      '</tbody></table>' +
    '</div>' +
  '</div>';

  var summaryHdr = '<div class="sec-head"><span class="sec-num">1</span> Итоговая сводка' +
    (isSingle ? ' — ' + fmtDate(s.dateB) + (s.weekB ? ' (' + escHTML(s.weekB) + ')' : '') :
      ' — нед. А: ' + fmtDate(s.dateA) + ' / нед. Б: ' + fmtDate(s.dateB)) + '</div>';
  // Page 1a: AI summary + KPIs + donuts + domain bars
  pages.push(
    '<div class="page">' +
      summaryHdr +
      aiSummaryHtml +
      buildKPIBlock(s, isSingle, qA, qB, dQ, ptsA, ptsB, dtsA, dtsB) +
      donutsHtml +
      buildDomainBarsChart(ptsA, ptsB, isSingle) +
      (isSingle ? '' : buildTopChangesChart(ptsA, ptsB)) +
      footer() +
    '</div>'
  );
  // Page 1b: timeline + summary tables
  pages.push(
    '<div class="page">' +
      '<div class="sec-head" style="font-size:10px"><span class="sec-num" style="font-size:8px">1</span> Итоговая сводка — детализация</div>' +
      buildSummaryTimeline(s) +
      summaryTablesHtml +
      footer() +
    '</div>'
  );

  // ── MAP PAGE ──
  var secNum = 2;
  // Usable height for map image: page height - top padding - bottom padding - footer - sec-head
  var mapMaxH = (s.orientation === 'landscape' ? 794 - 36 - 48 - 36 - 52 : 1123 - 48 - 60 - 36 - 52) + 'px';
  var mapImgStyle = 'width:100%;max-height:' + mapMaxH + ';object-fit:contain;border:1px solid #e0e0e0;border-radius:4px;display:block;margin:0 auto';
  if (s.includeMap && (imgs.imgA || imgs.imgB)) {
    if (isSingle && imgs.imgB) {
      pages.push(
        '<div class="page">' +
          '<div class="sec-head"><span class="sec-num" style="font-size:9px">M</span> Схема карьера — ' + escHTML(s.quarryName||'') + ' · ' + fmtDate(s.dateB) + '</div>' +
          '<div class="map-wrap"><img src="' + imgs.imgB + '" alt="Схема" style="' + mapImgStyle + '">' +
            '<div class="map-caption">Рис. 1. Схема карьера · ' + fmtDate(s.dateB) + ' (' + escHTML(s.weekB) + ')</div></div>' +
          footer() +
        '</div>'
      );
    } else {
      var cmpMapH = (s.orientation === 'landscape' ? 794 - 36 - 48 - 36 - 52 : 1123 - 48 - 60 - 36 - 52) + 'px';
      var cmpMapImgStyle = 'width:100%;max-height:' + cmpMapH + ';object-fit:contain;border:1px solid #e0e0e0;border-radius:4px;display:block';
      pages.push(
        '<div class="page">' +
          '<div class="sec-head"><span class="sec-num" style="font-size:9px">M</span> Схемы карьера — сравнение нед. А / нед. Б</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
            (imgs.imgA ? '<div class="map-wrap"><img src="' + imgs.imgA + '" alt="Нед.А" style="' + cmpMapImgStyle + '"><div class="map-caption">Нед. А · ' + fmtDate(s.dateA) + ' (' + escHTML(s.weekA) + ')</div></div>'
              : '<div style="background:#f8f9fa;border:1px solid #e0e0e0;border-radius:4px;padding:40px;text-align:center;color:#aaa;font-size:12px">Схема нед. А не загружена</div>') +
            (imgs.imgB ? '<div class="map-wrap"><img src="' + imgs.imgB + '" alt="Нед.Б" style="' + cmpMapImgStyle.replace('border:1px','border:2px') + ';border-color:#1a73e8"><div class="map-caption" style="color:#1a73e8">Нед. Б · ' + fmtDate(s.dateB) + ' (' + escHTML(s.weekB) + ')</div></div>'
              : '<div style="background:#e8f0fe;border:2px solid #1a73e8;border-radius:4px;padding:40px;text-align:center;color:#1a73e8;font-size:12px">Схема нед. Б не загружена</div>') +
          '</div>' +
          footer() +
        '</div>'
      );
    }
    secNum++;
  }

  // ── DOMAIN DETAILS ──
  if (s.includeDomens) {
    var isLandscape = s.orientation === 'landscape';

    // Page A: overview table for all domains (no cards), paginated
    // Usable height = page height - padding-top - padding-bottom - footer - section header (first page) - safety margin
    var domPageH = isLandscape ? (794 - 36 - 48 - 36 - 56 - 20) : (1123 - 48 - 60 - 36 - 56 - 20); // usable px
    var domBlocks = [];
    domenKeys.forEach(function(dom) {
      var dA = ptsA.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
      var dB = ptsB.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
      if (!dA.length && !dB.length) return;
      var qDA = dA.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
      var qDB = dB.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
      var dd  = qDB - qDA;
      var tableRows = dB.map(function(pb) {
        var pa = dA.find(function(p){ return p.pointNumber===pb.pointNumber; });
        var qa = pa ? parseFloat(pa.flowRate)||0 : null;
        var qb = parseFloat(pb.flowRate)||0;
        var delta = qa !== null ? qb - qa : null;
        return '<tr>' +
          '<td><b>' + escAttr(String(pb.pointNumber)) + '</b></td>' +
          '<td>' + escAttr(pb.status||'—') + '</td>' +
          '<td>' + escAttr(pb.intensity||'—') + '</td>' +
          (isSingle ? '' : '<td>' + (qa!==null?qa.toFixed(2):'—') + '</td>') +
          '<td><b>' + qb.toFixed(2) + '</b></td>' +
          (isSingle ? '' : '<td style="color:' + (delta!==null?(delta>=0?'#d93025':'#188038'):'') + ';font-weight:600">' +
            (delta!==null?(delta>=0?'▲+':'▼')+Math.abs(delta).toFixed(2):'—') + '</td>') +
          '<td>' + escAttr(pb.waterColor||'—') + '</td>' +
          '<td>' + escAttr(pb.measureMethod||'—') + '</td>' +
        '</tr>';
      }).join('');
      var blockHtml = '<div class="domen-block">' +
        '<div class="domen-hdr">' +
          '<div class="domen-hdr-name">' + escAttr(dom) + '</div>' +
          '<span class="domen-hdr-badge">' + (isSingle?dB.length:dA.length+'→'+dB.length) + ' точек</span>' +
          '<span class="domen-hdr-q">Q = ' + qDB.toFixed(2) + ' л/с</span>' +
          (!isSingle && qDA > 0 ? '<span class="domen-hdr-delta ' + (dd>=0?'delta-up':'delta-down') + '">' + (dd>=0?'▲+':'▼') + Math.abs(dd).toFixed(2) + ' л/с</span>' : '') +
        '</div>' +
        '<table><thead><tr>' +
          '<th>№</th><th>Статус</th><th>Интенсивность</th>' +
          (isSingle ? '' : '<th>Q нед. А</th>') +
          '<th>Q нед. Б</th>' +
          (isSingle ? '' : '<th>Δ</th>') +
          '<th>Цвет</th><th>Метод</th>' +
        '</tr></thead><tbody>' + tableRows + '</tbody></table>' +
      '</div>';
      // Header ~40px, table thead ~36px, each row ~34px, margin 20px (generous estimate)
      var estimH = 40 + 36 + dB.length * 34 + 20;
      domBlocks.push({ html: blockHtml, h: estimH });
    });
    // Split domain blocks across pages
    var domPages = [];
    var curPageBlocks = [], curH = 0;
    domBlocks.forEach(function(blk) {
      if (curH + blk.h > domPageH && curPageBlocks.length) {
        domPages.push(curPageBlocks);
        curPageBlocks = [];
        curH = 0;
      }
      curPageBlocks.push(blk.html);
      curH += blk.h;
    });
    if (curPageBlocks.length) domPages.push(curPageBlocks);
    if (!domPages.length) domPages = [[]];
    domPages.forEach(function(pageBlocks, idx) {
      var hdr = idx === 0 ? '<div class="sec-head"><span class="sec-num">' + secNum + '</span> По доменам</div>' : '';
      pages.push('<div class="page">' + hdr + pageBlocks.join('') + footer() + '</div>');
    });
    secNum++;

    // Pages B+: compact cards (photo 140px, tight padding) → ~420px each
    // Portrait 979px usable: 2 stacked cards (~840px) + header 52px + gap 8px = ~900px ✓
    // Landscape 622px usable: 2 side-by-side in grid, tallest card ≤ 622px ✓
    var maxCardsPerPage = 2;
    if (s.includePhotos || s.includeHistory) {
      domenKeys.forEach(function(dom) {
        var dA2 = ptsA.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
        var dB2 = ptsB.filter(function(p){ return (p.domain||p.domen||'—')===dom; });
        if (!dB2.length) return;
        var cards = [];
        dB2.forEach(function(pb) {
          var cache = ReportState.photoCache || {};
          var hasPhoto = cache['pt_' + pb.pointNumber + '_0_b'] || cache['pt_' + pb.pointNumber + '_0_a'];
          var hasHist  = ((ReportState.ptHistory||{})[String(pb.pointNumber)]||[]).length > 0;
          if ((s.includePhotos && hasPhoto) || (s.includeHistory && hasHist)) {
            var pa = dA2.find(function(p){ return p.pointNumber===pb.pointNumber; });
            cards.push(buildPointCard(pb, pa||null, s));
          }
        });
        if (!cards.length) return;
        var qDB2 = dB2.reduce(function(a,p){ return a+(parseFloat(p.flowRate)||0); },0);
        var domHdr = '<div class="sec-head"><span class="sec-num" style="font-size:9px">Д</span> ' + escAttr(dom) +
          ' <span style="font-size:10px;font-weight:500;color:#555">· Q = ' + qDB2.toFixed(2) + ' л/с · ' + dB2.length + ' точек</span></div>';
        var totalChunks = Math.ceil(cards.length / maxCardsPerPage);
        for (var ci = 0; ci < cards.length; ci += maxCardsPerPage) {
          var chunkIdx = Math.floor(ci / maxCardsPerPage);
          var chunk = cards.slice(ci, ci + maxCardsPerPage).join('');
          var contHdr = chunkIdx === 0 ? domHdr :
            '<div class="sec-head" style="font-size:10px">' +
              '<span class="sec-num" style="font-size:8px">Д</span> ' + escAttr(dom) +
              ' <span style="font-size:9px;color:#888;font-weight:400">продолжение (' + (chunkIdx+1) + '/' + totalChunks + ')</span>' +
            '</div>';
          pages.push(
            '<div class="page">' +
              contHdr +
              '<div style="' + (isLandscape ? 'display:grid;grid-template-columns:1fr 1fr;gap:14px;' : '') + 'padding:0">' +
                chunk +
              '</div>' +
              footer() +
            '</div>'
          );
        }
      });
    }
  }

  // ── DITCHES ──
  if (s.includeDitches) {
    var dToShow = dtsB.length ? dtsB : dtsA;
    if (dToShow.length) {
      var ditchPage = '<div class="page">' +
        '<div class="sec-head"><span class="sec-num">' + secNum + '</span> Канавы — детальные данные</div>';
      dToShow.forEach(function(d) {
        var hist = ReportState.history[d.ditchName] || [];
        ditchPage +=
          '<div class="ditch-block">' +
            '<div class="ditch-hdr">' +
              '<span class="ditch-icon">≈</span>' +
              '<span class="ditch-name">' + escAttr(d.ditchName) + '</span>' +
              '<span class="ditch-status">' + escAttr(d.status||'Активная') + '</span>' +
            '</div>' +
            '<div class="ditch-grid">' +
              '<div class="dp"><span class="dp-l">Дата</span><span class="dp-v">' + fmtDate(d.monitoringDate) + '</span></div>' +
              '<div class="dp"><span class="dp-l">Сотрудник</span><span class="dp-v">' + escAttr(d.worker||'—') + '</span></div>' +
              '<div class="dp"><span class="dp-l">Ширина B</span><span class="dp-v">' + (d.width!=null?d.width.toFixed(2)+' м':'—') + '</span></div>' +
              '<div class="dp"><span class="dp-l">Метод v</span><span class="dp-v">' + escAttr(d.velMethod==='float'?'Поплавок':d.velMethod==='multi'?'По точкам':'Одна v') + '</span></div>' +
              '<div class="dp"><span class="dp-l">v, м/с</span><span class="dp-v">' + (d.velocity!=null?d.velocity.toFixed(3):'—') + '</span></div>' +
              '<div class="dp"><span class="dp-l">S, м²</span><span class="dp-v">' + (d.area!=null?d.area.toFixed(4):'—') + '</span></div>' +
              '<div class="dp dp--accent"><span class="dp-l">Q, м³/ч</span><span class="dp-v">' + (d.flowM3h!=null?d.flowM3h.toFixed(3):'—') + '</span></div>' +
              '<div class="dp"><span class="dp-l">Глубины</span><span class="dp-v">' + (Array.isArray(d.depths)?d.depths.map(function(h){return (h*100).toFixed(1)+'см';}).join(', '):'—') + '</span></div>' +
            '</div>' +
            (d.comment ? '<div style="padding:6px 10px;font-size:11px;color:#555;background:#fffde7;border-top:1px solid #ffe082"><b>Комментарий:</b> ' + escAttr(d.comment) + '</div>' : '') +
            buildDitch2DSVG(d) +
            buildDitchHistTable(d.ditchName, hist) +
            (s.includePhotos ? buildDitchPhotos(d) : '') +
          '</div>';
      });
      ditchPage += footer() + '</div>';
      pages.push(ditchPage);
      secNum++;
    }
  }

  // ── DEWATERING ──
  if (s.includeDewatering) {
    var dewContent = buildDewateringSection(s);
    if (dewContent) {
      pages.push(
        '<div class="page">' +
          '<div class="sec-head"><span class="sec-num">' + secNum + '</span> Водоотлив</div>' +
          dewContent +
          footer() +
        '</div>'
      );
      secNum++;
    }
  }

  // ── COMPARE ──
  if (!isSingle && s.includeCompare && ptsA.length && ptsB.length) {
    var cmpAI = ai.compare ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.compare) + '</div>' : '';
    var cmpRows = ptsB.map(function(pb) {
      var pa = ptsA.find(function(p){ return p.pointNumber===pb.pointNumber; });
      var qa = pa ? parseFloat(pa.flowRate)||0 : null;
      var qb = parseFloat(pb.flowRate)||0;
      var delta = qa !== null ? qb - qa : null;
      var pct = (qa&&qa>0) ? (qb-qa)/qa*100 : null;
      var alert = delta!==null&&pct!==null&&Math.abs(pct)>=30 ? (delta>0?'⚠ рост':'✓ снижение') : '';
      return '<tr' + (alert?' style="background:#fff8e1"':'') + '>' +
        '<td><b>' + escAttr(String(pb.pointNumber)) + '</b></td>' +
        '<td>' + escAttr(pb.domain||pb.domen||'—') + '</td>' +
        '<td>' + escAttr(pb.status||'—') + '</td>' +
        '<td>' + (qa!==null?qa.toFixed(2):'—') + '</td>' +
        '<td><b>' + qb.toFixed(2) + '</b></td>' +
        '<td style="color:' + (delta!==null?(delta>=0?'#d93025':'#188038'):'') + ';font-weight:600">' + (delta!==null?(delta>=0?'▲+':'▼')+Math.abs(delta).toFixed(2):'—') + '</td>' +
        '<td style="color:' + (pct!==null?(pct>=0?'#d93025':'#188038'):'') + '">' + (pct!==null?(pct>=0?'+':'')+pct.toFixed(0)+'%':'—') + '</td>' +
        '<td>' + escAttr(alert) + '</td></tr>';
    }).join('');
    pages.push(
      '<div class="page">' +
        '<div class="sec-head"><span class="sec-num">' + secNum + '</span> Сравнение: ' + fmtDate(s.dateA) + ' vs ' + fmtDate(s.dateB) + '</div>' +
        cmpAI +
        '<table><thead><tr><th>№</th><th>Домен</th><th>Статус</th>' +
          '<th>Q нед. А, л/с</th><th>Q нед. Б, л/с</th><th>Δ, л/с</th><th>Δ, %</th><th>Оценка</th></tr></thead><tbody>' +
        cmpRows +
        '<tr style="background:#f1f3f4;font-weight:600;border-top:2px solid #e0e0e0"><td colspan="3"><b>Итого</b></td>' +
          '<td><b>' + qA.toFixed(2) + '</b></td><td><b>' + qB.toFixed(2) + '</b></td>' +
          '<td style="color:' + (dQ>=0?'#d93025':'#188038') + ';font-weight:700"><b>' + (dQ>=0?'▲+':'▼') + Math.abs(dQ).toFixed(2) + '</b></td>' +
          '<td style="color:' + (dQ>=0?'#d93025':'#188038') + '"><b>' + (qA>0?(dQ>=0?'+':'')+(dQ/qA*100).toFixed(0)+'%':'—') + '</b></td><td></td></tr>' +
        '</tbody></table>' +
        footer() +
      '</div>'
    );
    secNum++;
  }

  // ── WELLS ──
  if (s.includeWells) {
    var wellsPages = buildWellsSection(s, isSingle, secNum);
    if (wellsPages && wellsPages[0]) {
      wellsPages.forEach(function(pgContent) {
        if (pgContent) pages.push('<div class="page">' + pgContent + footer() + '</div>');
      });
      secNum++;
    }
  }

  // ── ANALYTICS: two pages — visual charts / then stats + AI ──
  var anlDomainHtml =
    buildWallDistribution(ptsB) +
    buildHorizonQBars(ptsB, ptsA, isSingle) +
    buildWellAnalysisBlock(s, isSingle);
  if (anlDomainHtml) {
    pages.push(
      '<div class="page">' +
        '<div class="sec-head"><span class="sec-num">' + secNum + '</span> Аналитика</div>' +
        anlDomainHtml + footer() +
      '</div>'
    );
  }
  var anlStatsHtml = buildAnalyticsContent(s, ptsA, ptsB, isSingle, ai);
  if (anlStatsHtml) {
    pages.push(
      '<div class="page">' +
        '<div class="sec-head" style="font-size:10px"><span class="sec-num" style="font-size:8px">' + secNum + '</span> Аналитика — статистика и аномалии</div>' +
        anlStatsHtml + footer() +
      '</div>'
    );
  }
  if (anlDomainHtml || anlStatsHtml) secNum++;

  // ── CONCLUSION ──
  var conclAI = ai.recommendations
    ? '<div class="rp-ai-text" style="margin-bottom:16px"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.recommendations) + '</div>'
    : '';
  pages.push(
    '<div class="page">' +
      '<div class="sec-head"><span class="sec-num">' + secNum + '</span> Заключение и рекомендации</div>' +
      conclAI +
      '<div class="conclusion-text">' +
        (s.conclusions
          ? escHTML(s.conclusions).replace(/\n/g,'<br>')
          : '<span style="color:#aaa;font-style:italic">Заключение не заполнено</span>') +
      '</div>' +
      footer() +
    '</div>'
  );

  return '<!DOCTYPE html><html lang="ru"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Отчёт — Карьер ' + escHTML(s.quarryName || 'ЮРГ') + ' — ' + fmtDate(s.dateB) + '</title>' +
    '<style>' + getReportCSS(s.reportTheme, s.orientation) + '</style>' +
    (s.watermark ? '<style>.page::before{content:"' + (s.watermark||'').replace(/"/g,'') + '";position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);font-size:72px;font-weight:800;color:rgba(220,53,69,.07);white-space:nowrap;pointer-events:none;z-index:0;letter-spacing:.1em}</style>' : '') +
    '</head><body>' +
    '<div class="pages-wrap">' + pages.join('') + '</div>' +
    '<div class="no-print">' +
      '<button onclick="window.print()">🖨 Печать / PDF</button>' +
      '<button onclick="window.close()" style="margin-left:8px">✕ Закрыть</button>' +
    '</div>' +
    '</body></html>';
}

// ── CSS отчёта ─────────────────────────────────────────────

function getReportCSS(theme, orientation) {
  return [
  '@import url(\'https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap\');',
  '* { box-sizing: border-box; margin: 0; padding: 0; }',
  'body { font-family: \'Inter\', Arial, sans-serif; font-size: 13px; color: #1a1a2e; background: #e8e8e8; line-height: 1.5; }',

  /* PAGE LAYOUT */
  '.pages-wrap { padding: 32px 0 64px; display: flex; flex-direction: column; align-items: center; gap: 32px; }',
  '.page { background: #fff; width: ' + (orientation==='landscape'?'1123px':'794px') + '; height: ' + (orientation==='landscape'?'794px':'1123px') + '; box-shadow: 0 4px 24px rgba(0,0,0,.18); position: relative; overflow: hidden; padding: ' + (orientation==='landscape'?'36px 52px 48px':'48px 52px 60px') + '; font-size: 13px; color: #1a1a2e; box-sizing: border-box; }',

  /* WATERMARK — content injected per-report via inline <style> only when s.watermark is set */
  '.page::before { content: \'\'; position: absolute; top: 50%; left: 50%; transform: translate(-50%,-50%) rotate(-45deg); font-size: 72px; font-weight: 800; color: rgba(220,53,69,.07); white-space: nowrap; pointer-events: none; z-index: 0; letter-spacing: .1em; }',
  '.page > * { position: relative; z-index: 1; }',

  /* PAGE FOOTER */
  '.page-footer { position: absolute; bottom: 0; left: 0; right: 0; height: 36px; background: #1a73e8; display: flex; align-items: center; padding: 0 52px; justify-content: space-between; }',
  '.page-footer span { font-size: 10px; color: rgba(255,255,255,.9); font-weight: 500; letter-spacing: .02em; }',

  /* SECTION HEADERS */
  '.sec-head { font-size: 12px; font-weight: 700; text-transform: uppercase; letter-spacing: .07em; color: #1a1a2e; padding-bottom: 7px; border-bottom: 2px solid #1a73e8; margin-bottom: 18px; display: flex; align-items: center; gap: 10px; }',
  '.sec-head .sec-num { width: 22px; height: 22px; background: #1a73e8; color: #fff; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 10px; font-weight: 700; flex-shrink: 0; }',
  '.sec-sub { font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: .05em; color: #555; margin: 14px 0 8px; }',

  /* KPI CARDS */
  '.kpi-grid { display: grid; grid-template-columns: repeat(' + (orientation==='landscape'?'4':'2') + ',1fr); gap: 12px; margin-bottom: 20px; }',
  '.kpi-card { background: #fff; border: 1px solid #e0e0e0; border-radius: 8px; padding: 14px 16px; }',
  '.kpi-val { font-size: 26px; font-weight: 800; color: #1a73e8; line-height: 1; margin-bottom: 3px; }',
  '.kpi-lbl { font-size: 10px; color: #555; font-weight: 500; text-transform: uppercase; letter-spacing: .04em; }',
  '.kpi-sub { font-size: 10px; color: #888; margin-top: 4px; }',

  /* TABLES */
  'table { width: 100%; border-collapse: collapse; font-size: 12px; margin-bottom: 16px; }',
  'thead th { background: #f5f7fa; font-weight: 700; font-size: 10px; text-transform: uppercase; letter-spacing: .04em; color: #555; padding: 8px 10px; text-align: left; border: 1px solid #e0e0e0; }',
  'tbody td { padding: 7px 10px; border: 1px solid #e0e0e0; color: #1a1a2e; vertical-align: middle; }',
  'tbody tr:nth-child(even) { background: #f9fbff; }',
  '.row-alert td { background: #fff8e1 !important; }',
  '.row-total td { background: #f1f3f4 !important; font-weight: 700; border-top: 2px solid #e0e0e0; }',

  /* STATUS BADGES */
  '.badge { display: inline-flex; align-items: center; gap: 4px; padding: 2px 8px; border-radius: 100px; font-size: 10px; font-weight: 600; }',
  '.badge-green { background: #e6f4ea; color: #188038; }',
  '.badge-blue  { background: #e8f0fe; color: #1557b0; }',
  '.badge-red   { background: #fce8e6; color: #c5221f; }',
  '.badge-amber { background: #fef7e0; color: #b45309; }',
  '.dot { width: 8px; height: 8px; border-radius: 50%; display: inline-block; flex-shrink: 0; }',
  '.dot-green  { background: #34a853; }',
  '.dot-blue   { background: #1a73e8; }',
  '.dot-red    { background: #ea4335; }',
  '.dot-amber  { background: #f9ab00; }',

  /* COLOR HELPERS */
  '.c-up   { color: #ea4335; }',
  '.c-down { color: #34a853; }',

  /* TITLE PAGE */
  '.title-header { display: flex; align-items: center; gap: 20px; margin-bottom: 20px; }',
  '.logo-box { width: 52px; height: 52px; border-radius: 10px; background: linear-gradient(135deg,#1a73e8,#0d47a1); display: flex; align-items: center; justify-content: center; font-size: 18px; font-weight: 800; color: #fff; flex-shrink: 0; }',
  '.title-company { flex: 1; }',
  '.title-company-name { font-size: 14px; font-weight: 700; color: #1a1a2e; letter-spacing: .04em; }',
  '.title-company-sub  { font-size: 11px; color: #555; margin-top: 2px; }',
  '.title-doc-meta { text-align: right; font-size: 11px; color: #555; }',
  '.title-doc-meta strong { display: block; font-size: 13px; color: #1a73e8; font-weight: 700; }',
  '.title-hr { border: none; border-top: 2px solid #e0e0e0; margin: 20px 0; }',
  '.title-label { text-align: center; font-size: 10px; font-weight: 700; letter-spacing: .15em; text-transform: uppercase; color: #888; margin-bottom: 12px; }',
  '.title-main { text-align: center; font-size: 22px; font-weight: 800; color: #1a1a2e; line-height: 1.3; margin-bottom: 16px; }',
  '.title-date-badge { display: inline-flex; align-items: center; gap: 8px; background: #e8f0fe; border: 1px solid #c5d9fb; border-radius: 8px; padding: 8px 20px; font-size: 13px; font-weight: 600; color: #1557b0; margin: 0 auto 40px; width: fit-content; }',
  '.sig-row { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; margin-top: 40px; }',
  '.sig-block { border-top: 1.5px solid #e0e0e0; padding-top: 12px; }',
  '.sig-role { font-size: 9px; font-weight: 700; letter-spacing: .1em; text-transform: uppercase; color: #888; margin-bottom: 6px; }',
  '.sig-name { font-size: 13px; font-weight: 600; color: #1a1a2e; }',
  '.sig-title-sub { font-size: 11px; color: #555; margin-top: 2px; }',
  '.title-blue-bar { position: absolute; bottom: 0; left: 0; right: 0; height: 6px; background: linear-gradient(90deg,#1a73e8,#0d47a1); }',

  /* DOMAIN BLOCKS */
  '.domen-block { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 14px; overflow: hidden; }',
  '.domen-hdr { display: flex; align-items: center; gap: 10px; background: #f5f7fa; padding: 8px 14px; border-bottom: 1px solid #e0e0e0; flex-wrap: wrap; }',
  '.domen-hdr-name { font-weight: 700; font-size: 13px; color: #1a1a2e; }',
  '.domen-hdr-badge { background: #e8f0fe; color: #1557b0; font-size: 10px; padding: 1px 8px; border-radius: 100px; font-weight: 600; }',
  '.domen-hdr-q { font-size: 12px; color: #444; margin-left: auto; font-weight: 600; }',
  '.domen-hdr-delta { font-size: 11px; font-weight: 700; padding: 1px 6px; border-radius: 4px; }',
  '.delta-up   { color: #ea4335; background: #fce8e6; }',
  '.delta-down { color: #34a853; background: #e6f4ea; }',

  /* DITCH BLOCKS */
  '.ditch-block { border: 1px solid #e0e0e0; border-radius: 8px; margin-bottom: 16px; overflow: hidden; }',
  '.ditch-hdr { display: flex; align-items: center; gap: 8px; background: #e8f0fe; padding: 8px 14px; border-bottom: 1px solid #c5d9fb; }',
  '.ditch-hdr-icon { font-size: 16px; color: #1a73e8; }',
  '.ditch-hdr-name { font-weight: 700; font-size: 13px; color: #1a1a2e; }',
  '.ditch-hdr-status { background: #1a73e8; color: #fff; font-size: 10px; padding: 1px 8px; border-radius: 100px; margin-left: auto; font-weight: 600; }',
  '.ditch-grid { display: grid; grid-template-columns: repeat(4,1fr); gap: 1px; background: #e0e0e0; border-bottom: 1px solid #e0e0e0; }',
  '.dp { background: #fff; padding: 7px 10px; }',
  '.dp--accent { background: #f0f9f0; }',
  '.dp-l { display: block; font-size: 9px; color: #888; text-transform: uppercase; letter-spacing: .04em; margin-bottom: 2px; }',
  '.dp-v { font-size: 12px; font-weight: 600; color: #1a1a2e; }',
  '.dp--accent .dp-v { color: #188038; }',

  /* PHOTOS */
  '.photo-row { display: flex; gap: 12px; align-items: flex-start; border: 1px solid #e0e0e0; border-radius: 6px; overflow: hidden; margin-bottom: 10px; }',
  '.photo-img-wrap { flex: 0 0 260px; background: #f5f7fa; }',
  '.photo-img { width: 260px; height: 195px; object-fit: cover; display: block; }',
  '.photo-img-lbl { font-size: 9px; color: #888; text-align: center; padding: 3px; background: #f1f3f4; }',
  '.photo-info { flex: 1; padding: 10px 12px; min-width: 0; }',
  '.photo-info-title { font-size: 13px; font-weight: 700; color: #1a1a2e; margin-bottom: 8px; }',
  '.photo-comment { font-size: 11px; color: #444; background: #f8f9fa; border-left: 3px solid #1a73e8; border-radius: 0 4px 4px 0; padding: 6px 8px; line-height: 1.5; margin-top: 8px; }',

  /* AI BLOCKS */
  '.rp-ai-text { background: #f3f0ff; border-left: 3px solid #7f77dd; border-radius: 0 5px 5px 0; padding: 8px 12px; margin-bottom: 10px; font-size: 12px; color: #333; line-height: 1.6; }',
  '.rp-ai-badge { display: inline-block; background: #7f77dd; color: #fff; font-size: 9px; font-weight: 700; padding: 1px 6px; border-radius: 3px; margin-right: 6px; letter-spacing: .05em; }',

  /* MAP & CONCLUSION */
  '.map-wrap { margin: 10px 0 16px; }',
  '.map-caption { font-size: 10px; color: #888; text-align: center; margin-top: 4px; font-style: italic; }',
  '.conclusion-text { font-size: 13px; color: #1a1a2e; line-height: 1.7; padding: 16px; background: #f8faff; border-radius: 8px; border-left: 4px solid #1a73e8; white-space: pre-wrap; }',

  /* PRINT BUTTON */
  '.no-print { position: fixed; bottom: 20px; right: 20px; z-index: 100; }',
  '.no-print button { padding: 10px 20px; font-size: 13px; cursor: pointer; background: #1a73e8; color: #fff; border: none; border-radius: 8px; font-weight: 600; box-shadow: 0 2px 8px rgba(26,115,232,.35); }',

  /* PRINT */
  '@media print {',
  '  body { background: white; }',
  '  .pages-wrap { padding: 0; }',
  '  .page { box-shadow: none; page-break-after: always; }',
  '  @page { size: A4 ' + (orientation === 'landscape' ? 'landscape' : 'portrait') + '; margin: 0; }',
  '  .no-print { display: none !important; }',
  '  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }',
  '  .domen-block, .ditch-block, .photo-row, .kpi-grid { page-break-inside: avoid; break-inside: avoid; }',
  '  .photo-img-wrap { flex: 0 0 200px !important; }',
  '  .photo-img { width: 200px !important; height: 150px !important; }',
  '  .map-wrap img, .ditch-block img { max-width: 100% !important; height: auto !important; max-height: 220px !important; }',
  '}'
  ].join('\n');
}
