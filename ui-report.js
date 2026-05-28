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
    aiModel: 'claude-haiku-4-5-20251001',
    aiTone: 'official',
    quarryName: 'ЮРГ',
    objectName: 'Пулково-42',
    reportTheme: 'blue',
    reportLayout: 'a',
    filterDomains:  [],   // [] = all domains
    filterHorizons: [],   // [] = all horizons
  },
  currentStep: 1,
};

// ── Утилиты ───────────────────────────────────────────────

var RP_SECTIONS = [
  { id: 'map',        chk: 'rp-inc-map',        label: 'Схема карьера',      icon: '🗺',  defOn: true  },
  { id: 'domens',     chk: 'rp-inc-domens',      label: 'Домены / горизонты', icon: '📊',  defOn: true  },
  { id: 'dewatering', chk: 'rp-inc-dewatering',  label: 'Водоотлив',          icon: '💧',  defOn: false },
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
  // Also sync the AI checkbox duplicate
  var aiCb = document.getElementById('rp-inc-ai-cb');
  if (aiCb && s.incAI !== undefined) aiCb.checked = s.incAI;

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
      reportTheme:   ReportState.settings.reportTheme || 'blue',
      reportLayout:  ReportState.settings.reportLayout || 'a',
      watermark:    (function(){ var v=getField('rp-watermark'); return v==='custom'?getField('rp-watermark-custom'):v; })(),
      approverName: getField('rp-approver-name'),
      incSignature: getChk('rp-inc-signature'),
      aiModel: getField('rp-ai-model') || 'claude-haiku-4-5-20251001',
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
      ReportState.settings.aiModel = getField('rp-ai-model') || 'claude-haiku-4-5-20251001';
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
        '<div><label class="rp-lbl">Название карьера</label><input class="form-input" id="rp-quarry-name" placeholder="ЮРГ" style="margin-top:4px"></div>' +
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
    '<div class="rp-panel-title">ИИ-анализ (Claude)</div>' +
    '<div class="rp-panel-sub">Настройте автоматические текстовые выводы</div>' +

    '<div class="card" style="margin-bottom:14px">' +
      '<label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;margin-bottom:10px">' +
        '<input type="checkbox" id="rp-inc-ai-cb" checked ' +
          'onchange="var cb=document.getElementById(\'rp-inc-ai\');if(cb)cb.checked=this.checked;saveReportSettings()"> ' +
        'Включить AI-анализ при формировании' +
      '</label>' +
      '<label class="rp-lbl">Anthropic API ключ</label>' +
      '<input class="form-input" id="rp-apikey" type="password" placeholder="sk-ant-..." ' +
        'style="margin-top:4px;font-family:monospace;font-size:12px">' +
      '<div style="font-size:10px;color:var(--txt-3);margin-top:3px">Ключ хранится только в браузере</div>' +
    '</div>' +

    '<div class="card" style="margin-bottom:14px">' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
        '<div>' +
          '<label class="rp-lbl">Модель Claude</label>' +
          '<select class="form-select" id="rp-ai-model" style="margin-top:4px" onchange="saveReportSettings()">' +
            '<option value="claude-haiku-4-5-20251001">Haiku 4.5 — быстро и дёшево</option>' +
            '<option value="claude-sonnet-4-6">Sonnet 4.6 — баланс (рекомендуется)</option>' +
            '<option value="claude-opus-4-7">Opus 4.7 — глубокий анализ</option>' +
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
  if (!apiKey) { Toast.show('Введите Anthropic API ключ', 'error'); return; }
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
  var model = getField('rp-ai-model') || ReportState.settings.aiModel || 'claude-haiku-4-5-20251001';
  callClaudeAPI(apiKey, prompt, model).then(function(text) {
    var ta = document.getElementById('rp-conclusions');
    if (ta) ta.value = text;
    Toast.show('Заключение сгенерировано', 'success');
  }).catch(function(err) {
    Toast.show('Ошибка AI: ' + err.message, 'error');
  }).finally(function() {
    if (btn) { btn.disabled = false; btn.textContent = '✨ Сгенерировать через AI'; }
  });
}

function callClaudeAPI(apiKey, prompt, model) {
  var mdl = model || ReportState.settings.aiModel || 'claude-haiku-4-5-20251001';
  return fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true'
    },
    body: JSON.stringify({
      model: mdl,
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  }).then(function(r) { return r.json(); }).then(function(data) {
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    if (!data.content) throw new Error('Пустой ответ API: ' + JSON.stringify(data));
    return (data.content && data.content[0]) ? data.content[0].text : '';
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

  return callClaudeAPI(s.apiKey, prompt, s.aiModel).then(function(text) {
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
  if (!apiKey) { Toast.show('Введите API-ключ Claude', 'error'); return; }
  if (!ReportState.allPoints.length) { Toast.show('Сначала загрузите данные (Шаг 1)', 'error'); return; }

  var btn = document.getElementById('rp-pre-ai-btn');
  var container = document.getElementById('rp-ai-preview-blocks');
  if (btn) { btn.disabled = true; btn.textContent = '⏳ Генерация...'; }
  if (container) container.innerHTML = '<div style="font-size:12px;color:var(--txt-3);text-align:center;padding:12px">Запрос к Claude API...</div>';

  var s = Object.assign({}, ReportState.settings);
  s.author       = getField('rp-author');
  s.position     = getField('rp-position');
  s.dateA        = getField('rp-date-a');
  s.dateB        = getField('rp-date-b');
  s.reportMode   = ReportState.settings.reportMode || 'compare';
  s.dateB        = s.reportMode === 'single' ? s.dateA : s.dateB;
  s.apiKey       = apiKey;
  s.customPrompt = getField('rp-custom-prompt');
  s.aiModel = getField('rp-ai-model') || ReportState.settings.aiModel || 'claude-haiku-4-5-20251001';
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
  s.quarryName     = getField('rp-quarry-name') || 'ЮРГ';
  s.objectName     = getField('rp-object-name') || 'Пулково-42';
  s.reportTheme = ReportState.settings.reportTheme || 'blue';
  s.reportLayout = ReportState.settings.reportLayout || 'a';
  s.logoBase64   = localStorage.getItem('rp-logo-base64') || '';
  var wmVal = getField('rp-watermark');
  s.watermark    = wmVal === 'custom' ? getField('rp-watermark-custom') : wmVal;
  s.approverName = getField('rp-approver-name');
  s.includeSignature = getChk('rp-inc-signature');
  s.aiModel = getField('rp-ai-model') || ReportState.settings.aiModel || 'claude-haiku-4-5-20251001';
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

  function photoBlock(src, weekLabel, dateLabel, labelBg) {
    var imgHtml = src
      ? '<img src="' + src + '" style="width:100%;height:190px;object-fit:cover;display:block" alt="' + escAttr(weekLabel) + '">'
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
        '<img src="' + srcB2 + '" style="width:100%;max-height:200px;object-fit:cover;display:block">' +
        '<div style="padding:4px 10px;font-size:10px;color:#888;background:#f8f9fa">' + fmtDate(s.dateB) + ' · ' + escAttr(s.weekB) + '</div>' +
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
      ? '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">' + (isSingle && pa && pa.monitoringDate ? normDateISO(pa.monitoringDate).slice(5).split('-').reverse().join('.') : 'Q нед. А') + '</div>' +
          '<div style="font-size:14px;font-weight:700;color:#1a1a2e">' + qa.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span></div></div>'
      : '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Метод</div>' +
          '<div style="font-size:11px;color:#555">' + escAttr(pb.measureMethod || '—') + '</div></div>') +
    '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">' + (isSingle && pb.monitoringDate ? normDateISO(pb.monitoringDate).slice(5).split('-').reverse().join('.') : 'Q нед. Б') + '</div>' +
      '<div style="font-size:14px;font-weight:700;color:#1a73e8">' + qb.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span></div></div>' +
    '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Изменение</div>' +
      '<div style="font-size:14px;font-weight:700;color:' + trendColor + '">' +
        (delta != null ? trendArrow + ' ' + (delta >= 0 ? '+' : '') + delta.toFixed(2) + ' <span style="font-size:10px;color:#aaa">л/с</span>' : '—') +
      '</div></div>' +
    '<div style="background:#fff;padding:8px 12px"><div style="font-size:9px;text-transform:uppercase;letter-spacing:.05em;color:#aaa;margin-bottom:3px">Замеров в истории</div>' +
      '<div style="font-size:14px;font-weight:700;color:#555">' + numHist + '</div></div>' +
  '</div>';

  // ── Комментарий (полевое описание — гидрогеологическое наблюдение)
  var commentRow = pb.comment
    ? '<div style="padding:10px 16px;border-top:1px solid #e0e6f0;' +
        'background:#fffde7;border-left:3px solid #f9ab00">' +
        '<div style="font-size:9px;text-transform:uppercase;letter-spacing:.06em;' +
          'color:#b8860b;font-weight:700;margin-bottom:4px">Полевое наблюдение</div>' +
        '<div style="font-size:12px;line-height:1.6;color:#333">' + escAttr(pb.comment) + '</div>' +
      '</div>'
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
      '<div class="rp-photo-img-wrap"><img src="' + b64 + '" alt="Точка #' + escAttr(String(p.pointNumber)) + '" class="rp-photo-img">' +
        '<div class="rp-photo-label">Точка #' + escAttr(String(p.pointNumber)) + '</div></div>' +
      '<div class="rp-photo-info">' +
        '<div class="rp-photo-info-title">Точка #' + escAttr(String(p.pointNumber)) + '</div>' +
        '<table class="rp-photo-meta">' +
          (p.status    ? '<tr><td>Статус</td><td>'       + escAttr(p.status)    + '</td></tr>' : '') +
          (p.intensity ? '<tr><td>Интенсивность</td><td>'+ escAttr(p.intensity) + '</td></tr>' : '') +
          '<tr><td>Q</td><td>' + (parseFloat(p.flowRate)||0).toFixed(2) + ' л/с</td></tr>' +
          (p.waterColor ? '<tr><td>Цвет воды</td><td>'  + escAttr(p.waterColor) + '</td></tr>' : '') +
        '</table>' +
        (p.comment
          ? '<div class="rp-photo-comment"><b>Комментарий:</b> ' + escAttr(p.comment) + '</div>'
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
      '<div class="rp-photo-img-wrap"><img src="' + b64 + '" alt="' + escAttr(d.ditchName) + '" class="rp-photo-img">' +
        '<div class="rp-photo-label">' + escAttr(d.ditchName) + ' · фото ' + (i+1) + '</div></div>' +
      '<div class="rp-photo-info">' +
        '<div class="rp-photo-info-title">' + escAttr(d.ditchName) + '</div>' +
        '<table class="rp-photo-meta">' +
          '<tr><td>Дата</td><td>' + fmtDate(d.monitoringDate) + '</td></tr>' +
          '<tr><td>Статус</td><td>' + escAttr(d.status||'—') + '</td></tr>' +
          '<tr><td>Q</td><td>' + (d.flowM3h!=null?d.flowM3h.toFixed(3)+' м³/ч':'—') + '</td></tr>' +
        '</table>' +
        (d.comment ? '<div class="rp-photo-comment"><b>Комментарий:</b> ' + escAttr(d.comment) + '</div>' : '') +
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
    return '<tr><td>' + escAttr(String(h.monitoringDate||'—')) + '</td>' +
      '<td>' + (h.area!=null?h.area.toFixed(4):'—') + '</td>' +
      '<td><b>' + (h.flowM3h!=null?h.flowM3h.toFixed(3):'—') + '</b></td>' +
      '<td>' + (h.velocity!=null?h.velocity.toFixed(3):'—') + '</td>' +
      '<td>' + escAttr(h.worker||'—') + '</td></tr>';
  }).join('');
  return '<div class="rp-ditch-hist"><div class="rp-section-sub">История замеров</div>' +
    '<table class="rp-table"><thead><tr><th>Дата</th><th>S, м²</th><th>Q, м³/ч</th><th>v, м/с</th><th>Сотрудник</th></tr></thead>' +
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
    '<div class="rp-kpi-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:14px">' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + sumps.length + '</div><div class="rp-kpi-label">Зумпфов</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + activePumps.length + '</div><div class="rp-kpi-label">Работающих насосов</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + Math.round(totalVol).toLocaleString('ru-RU') + '</div><div class="rp-kpi-label">Объём откачки, м³</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + Object.keys(latestLevel).length + '</div><div class="rp-kpi-label">Зумпфов с замерами уровня</div></div>' +
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
    ? '<div class="rp-section-sub">Насосы</div>' +
      '<table class="rp-table"><thead><tr>' +
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
    ? '<div class="rp-section-sub" style="margin-top:14px">Отметки уровня воды в зумпфах</div>' +
      '<table class="rp-table"><thead><tr>' +
        '<th>Зумпф</th><th>Карьер</th><th>Дата замера</th>' +
        '<th style="text-align:right">Уровень</th><th style="text-align:right">Глубина</th>' +
      '</tr></thead><tbody>' + wlRows + '</tbody></table>'
    : '';

  if (!kpiHtml && !pumpsTable && !wlTable) return '';

  return '<section class="rp-section">' +
    '<h2>Водоотлив: насосы и уровни воды</h2>' +
    (s.dewDiagImg ? '<div style="margin-bottom:16px;text-align:center"><img src="' + s.dewDiagImg + '" style="max-width:100%;border-radius:8px;border:1px solid #dee2e6" alt="Схема водоотлива"></div>' : '') +
    '<div style="font-size:11px;color:#888;margin-bottom:10px">Период: ' +
      escHTML(dateFrom) + (dateFrom !== dateTo ? ' — ' + escHTML(dateTo) : '') +
    '</div>' +
    kpiHtml + pumpsTable + wlTable +
  '</section>';
}

// ── Титульная страница (зависит от макета) ────────────────
function buildTitleHTML(s, isSingle) {
  var layout = s.reportLayout || 'a';
  var c = getThemeColors(s.reportTheme);

  // Логотип
  var logoHtml = s.logoBase64
    ? '<img src="' + s.logoBase64 + '" class="rp-title-logo-img" alt="logo">'
    : '<div class="rp-title-logo">' + escHTML(s.quarryName || 'ЮРГ') + '</div>';

  var signatureHtml = s.includeSignature
    ? '<div class="rp-signature-block">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:30px;text-align:left">' +
          '<div><div class="rp-sig-line">________________________</div>' +
            '<div class="rp-sig-label">Составил: ' + escHTML(s.author || '') + '</div>' +
            '<div class="rp-sig-role">' + escHTML(s.position || '') + '</div></div>' +
          '<div><div class="rp-sig-line">________________________</div>' +
            '<div class="rp-sig-label">Утвердил: ' + escHTML(s.approverName || '') + '</div></div>' +
        '</div></div>'
    : '';

  var periodText = isSingle
    ? 'Дата: ' + fmtDate(s.dateB) + (s.weekB ? ' (' + escHTML(s.weekB) + ')' : '')
    : fmtDate(s.dateA) + ' (' + escHTML(s.weekA) + ') → ' + fmtDate(s.dateB) + ' (' + escHTML(s.weekB) + ')';

  // ── Вариант C: бланк ГОСТ ──
  if (layout === 'c') {
    return '<div class="rp-title-page rp-title-c">' +
      '<div class="rp-lh-top">' +
        '<div class="rp-lh-logo">' + (s.logoBase64 ? '<img src="' + s.logoBase64 + '" class="rp-title-logo-img" alt="logo">' : '<div class="rp-lh-logo-box">' + escHTML(s.quarryName || 'ЮРГ') + '</div>') + '</div>' +
        '<div class="rp-lh-org">' +
          '<div class="rp-lh-org-name">' + escHTML(s.quarryName || 'ЮРГ') + ' · Гидрогеологический мониторинг</div>' +
          '<div class="rp-lh-org-sub">Объект ' + escHTML(s.objectName || '') + '</div>' +
        '</div>' +
        '<div class="rp-lh-docnum">' +
          '<div class="rp-lh-label">Документ</div>' +
          '<div class="rp-lh-num">№ v' + (s.reportVersion || 1) + '</div>' +
          '<div class="rp-lh-date">' + fmtDate(s.dateReport) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rp-lh-title-block">' +
        '<div class="rp-lh-doctype">Технический отчёт</div>' +
        '<div class="rp-lh-main">Отчёт по мониторингу подземных вод<br>' + escHTML(s.quarryName || 'ЮРГ') + ' · ' + escHTML(s.objectName || '') + '</div>' +
        '<div class="rp-lh-period-box">' + periodText + '</div>' +
      '</div>' +
      '<div class="rp-lh-signers">' +
        '<div><div class="rp-lh-role">Составил</div><div class="rp-lh-line"></div><div class="rp-lh-name">' + escHTML(s.author || '—') + ' · ' + escHTML(s.position || '') + '</div></div>' +
        '<div><div class="rp-lh-role">Утвердил</div><div class="rp-lh-line"></div><div class="rp-lh-name">' + escHTML(s.approverName || '—') + '</div></div>' +
      '</div>' +
    '</div>';
  }

  // ── Вариант B: дашборд ──
  if (layout === 'b') {
    return '<div class="rp-title-page rp-title-b">' +
      '<div class="rp-title-b-topbar">' +
        (s.logoBase64
          ? '<img src="' + s.logoBase64 + '" class="rp-title-logo-img" style="max-height:36px;border-radius:4px" alt="logo">'
          : '<div class="rp-title-b-logo">' + escHTML(s.quarryName || 'ЮРГ') + '</div>') +
        '<div><div class="rp-title-b-org-label">' + escHTML(s.quarryName || 'ЮРГ') + ' · Гидрогеологический мониторинг</div>' +
          '<div class="rp-title-b-org-name">Объект ' + escHTML(s.objectName || '') + '</div></div>' +
        '<div style="margin-left:auto;text-align:right">' +
          '<div class="rp-title-b-vnum-label">Версия</div>' +
          '<div class="rp-title-b-vnum">v' + (s.reportVersion || 1) + '</div>' +
        '</div>' +
      '</div>' +
      '<div class="rp-title-b-bottom">' +
        '<h1 class="rp-title-b-h1">Отчёт по мониторингу подземных вод</h1>' +
        '<div class="rp-title-b-chips">' +
          '<span class="rp-title-b-chip rp-title-b-chip--blue">📅 ' + periodText + '</span>' +
          '<span class="rp-title-b-chip">👤 ' + escHTML(s.author || '—') + ' · ' + fmtDate(s.dateReport) + '</span>' +
        '</div>' +
      '</div>' +
      signatureHtml +
    '</div>';
  }

  // ── Варианты A и A+B: тёмная gradient-шапка ──
  return '<div class="rp-title-page rp-title-a">' +
    '<div class="rp-title-a-content">' +
      logoHtml +
      '<div class="rp-title-body">' +
        '<div class="rp-title-org">Карьер ' + escHTML(s.quarryName || 'ЮРГ') + ' · Отдел гидрогеологии</div>' +
        '<h1 class="rp-title-main">Отчёт по мониторингу<br>подземных вод</h1>' +
        '<div class="rp-title-sub">Объект ' + escHTML(s.objectName || '') + '</div>' +
        '<div class="rp-title-period">' + periodText + '</div>' +
        '<div class="rp-title-meta">' +
          '<div>Составил: <b>' + escHTML(s.author || '—') + '</b> · ' + escHTML(s.position || '') + '</div>' +
          '<div>Дата: <b>' + fmtDate(s.dateReport) + '</b> · v' + (s.reportVersion || 1) + '</div>' +
          (s.approverName ? '<div>Утверждает: <b>' + escHTML(s.approverName) + '</b></div>' : '') +
        '</div>' +
      '</div>' +
    '</div>' +
    signatureHtml +
  '</div>';
}

// ── KPI-блок (зависит от макета) ──────────────────────────
function buildKPIBlock(s, isSingle, qA, qB, dQ, ptsA, ptsB, dtsA, dtsB) {
  var layout = s.reportLayout || 'a';
  var dtQA = dtsA.reduce(function(a,d){ return a+(d.flowM3h||0); },0);
  var dtQB = dtsB.reduce(function(a,d){ return a+(d.flowM3h||0); },0);
  var floodB = ptsB.filter(function(p){ return p.status==='Паводковая'||p.status==='Перелив'; }).length;
  var floodA = ptsA.filter(function(p){ return p.status==='Паводковая'||p.status==='Перелив'; }).length;
  var dFlood = floodB - floodA;

  if (layout === 'b' || layout === 'ab') {
    // Цветные KPI-карточки
    var cards = [
      { icon:'💧', cls:'blue',  val: qB.toFixed(1) + ' л/с',        lbl:'Σ Q нед. Б',          sub: isSingle ? '' : 'нед. А: ' + qA.toFixed(1) },
      { icon:'📈', cls: dQ>=0 ? 'red':'green',
                               val: (dQ>=0?'▲+':'▼') + Math.abs(dQ).toFixed(1), lbl:'Изменение Δ л/с',   sub: (dQ>=0?'+':'')+((qA>0?(dQ/qA*100):0).toFixed(1))+'%' },
      { icon:'⚠️', cls:'amber', val: String(floodB),                 lbl:'Паводковых точек',     sub: dFlood!==0?(dFlood>0?'▲+'+dFlood:'▼'+dFlood)+' vs нед.А':'' },
      { icon:'✅', cls:'green2',val: String(ptsB.length),             lbl:'Точек замерено',       sub: '' },
      { icon:'🏗',  cls:'purple',val: dtsB.length + ' / ' + dtQB.toFixed(0)+' м³/ч', lbl:'Канав / Σ Q канав', sub: '' },
    ];
    return '<div class="rp-kpi-cards">' +
      cards.map(function(k){
        return '<div class="rp-kpi-card rp-kpi-card--' + k.cls + '">' +
          '<div class="rp-kpi-card-icon">' + k.icon + '</div>' +
          '<div class="rp-kpi-card-val">' + k.val + '</div>' +
          '<div class="rp-kpi-card-lbl">' + k.lbl + '</div>' +
          (k.sub ? '<div class="rp-kpi-card-sub">' + k.sub + '</div>' : '') +
        '</div>';
      }).join('') +
    '</div>';
  }

  // Вариант A и C: горизонтальный KPI-бар
  if (isSingle) {
    return '<div class="rp-kpi-grid">' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsB.length + '</div><div class="rp-kpi-label">Точек мониторинга</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + qB.toFixed(1) + ' <span style="font-size:13px">л/с</span></div><div class="rp-kpi-label">Суммарный водоприток</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + floodB + '</div><div class="rp-kpi-label">Активных/паводковых</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + dtsB.length + '</div><div class="rp-kpi-label">Канав</div></div>' +
      '<div class="rp-kpi"><div class="rp-kpi-val">' + dtQB.toFixed(1) + ' <span style="font-size:13px">м³/ч</span></div><div class="rp-kpi-label">ΣQ канав</div></div>' +
    '</div>';
  }
  var trend = dQ >= 0 ? 'rp-kpi--up' : 'rp-kpi--down';
  return '<div class="rp-kpi-compare">' +
    '<div class="rp-kpi-compare-week rp-kpi-compare-week--a">' +
      '<div class="rp-kpi-compare-label">Нед. А · ' + fmtDate(s.dateA) + '</div>' +
      '<div class="rp-kpi-grid2">' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsA.length + '</div><div class="rp-kpi-label">Точек</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + qA.toFixed(1) + '</div><div class="rp-kpi-label">Q л/с</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + dtsA.length + '</div><div class="rp-kpi-label">Канав</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + dtQA.toFixed(1) + '</div><div class="rp-kpi-label">Q канав м³/ч</div></div>' +
      '</div></div>' +
    '<div class="rp-kpi-arrow">' +
      '<div style="font-size:20px;color:#aaa">→</div>' +
      '<div class="rp-kpi ' + trend + '" style="min-width:70px;text-align:center">' +
        '<div class="rp-kpi-val" style="font-size:15px">' + (dQ>=0?'▲+':'▼') + Math.abs(dQ).toFixed(1) + '</div>' +
        '<div class="rp-kpi-label">Δ л/с</div></div></div>' +
    '<div class="rp-kpi-compare-week rp-kpi-compare-week--b">' +
      '<div class="rp-kpi-compare-label" style="color:#1a73e8">Нед. Б · ' + fmtDate(s.dateB) + '</div>' +
      '<div class="rp-kpi-grid2">' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + ptsB.length + '</div><div class="rp-kpi-label">Точек</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + qB.toFixed(1) + '</div><div class="rp-kpi-label">Q л/с</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + dtsB.length + '</div><div class="rp-kpi-label">Канав</div></div>' +
        '<div class="rp-kpi"><div class="rp-kpi-val">' + dtQB.toFixed(1) + '</div><div class="rp-kpi-label">Q канав м³/ч</div></div>' +
      '</div></div>' +
  '</div>';
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
  var title = buildTitleHTML(s, isSingle);

  // ── Сводка
  var summaryAI = ai.error
    ? '<div class="rp-ai-text" style="color:#d93025"><span class="rp-ai-badge" style="background:#d93025">AI</span>⚠ ' + escHTML(ai.error) + '</div>'
    : ai.summary ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.summary) + '</div>' : '';

  var summaryContent = buildKPIBlock(s, isSingle, qA, qB, dQ, ptsA, ptsB, dtsA, dtsB);
  // Сравнительные диаграммы (только для compare + layout не-B/AB)
  var summaryCharts = '';
  var layout = s.reportLayout || 'a';
  if (!isSingle && layout !== 'b' && layout !== 'ab') {
    summaryCharts =
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:14px">' +
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
    if (isSingle) {
      return '<tr><td><b>' + escAttr(dom) + '</b></td>' +
        '<td style="text-align:center">' + dB.length + '</td>' +
        '<td style="text-align:right;color:#1a73e8;font-weight:600">' + qDB.toFixed(2) + '</td></tr>';
    }
    return '<tr><td><b>' + escAttr(dom) + '</b></td>' +
      '<td style="text-align:center">' + dA.length + '</td>' +
      '<td style="text-align:right">' + qDA.toFixed(2) + '</td>' +
      '<td style="text-align:center">' + dB.length + '</td>' +
      '<td style="text-align:right;color:#1a73e8;font-weight:600">' + qDB.toFixed(2) + '</td>' +
      '<td class="' + (dd>=0?'rp-up':'rp-down') + '">' + (dd>=0?'+':'') + dd.toFixed(2) + '</td></tr>';
  }).join('');

  var summary = '<section class="rp-section"><h2>1. Итоговая сводка</h2>' +
    summaryAI + summaryContent + summaryCharts +
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
      mapSection = '<section class="rp-section"><h2>2. Схема карьера ' + escHTML(s.quarryName) + '</h2>' +
        '<div class="rp-map-wrap"><img src="' + imgs.imgB + '" alt="Схема" style="width:100%;border:1px solid #dee2e6;border-radius:4px">' +
        '<div class="rp-map-caption">Рис. 1. Схема карьера · ' + fmtDate(s.dateB) + ' (' + escAttr(s.weekB) + ')</div></div></section>';
    } else {
      mapSection = '<section class="rp-section"><h2>2. Схемы карьера ' + escHTML(s.quarryName) + ' — сравнение</h2>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
          (imgs.imgA ? '<div class="rp-map-wrap"><img src="' + imgs.imgA + '" alt="Нед. А" style="width:100%;border:1px solid #dee2e6;border-radius:4px">' +
            '<div class="rp-map-caption">Нед. А · ' + fmtDate(s.dateA) + ' (' + escAttr(s.weekA) + ')</div></div>'
            : '<div style="background:#f8f9fa;border:1px solid #dee2e6;border-radius:4px;padding:40px;text-align:center;color:#aaa;font-size:12px">Схема нед. А не загружена</div>') +
          (imgs.imgB ? '<div class="rp-map-wrap"><img src="' + imgs.imgB + '" alt="Нед. Б" style="width:100%;border:2px solid #1a73e8;border-radius:4px">' +
            '<div class="rp-map-caption" style="color:#1a73e8">Нед. Б · ' + fmtDate(s.dateB) + ' (' + escAttr(s.weekB) + ')</div></div>'
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
          '<span class="rp-domen-name">' + escAttr(dom) + '</span>' +
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
          '<td><b>' + escAttr(String(pb.pointNumber)) + '</b></td>' +
          '<td>' + escAttr(pb.status||'—') + '</td>' +
          '<td>' + escAttr(pb.intensity||'—') + '</td>' +
          (isSingle ? '' : '<td>' + (qa!==null?qa.toFixed(2):'—') + '</td>') +
          '<td><b>' + qb.toFixed(2) + '</b></td>' +
          (isSingle ? '' : '<td class="' + (delta!==null?(delta>=0?'rp-up':'rp-down'):'') + '">' + (delta!==null?(delta>=0?'+':'')+delta.toFixed(2):'—') + '</td>') +
          '<td>' + escAttr(pb.waterColor||'—') + '</td>' +
          '<td>' + escAttr(pb.measureMethod||'—') + '</td>' +
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
              '<span class="rp-ditch-name">' + escAttr(d.ditchName) + '</span>' +
              '<span class="rp-ditch-status">' + escAttr(d.status||'Активная') + '</span>' +
            '</div>' +
            '<div class="rp-ditch-grid">' +
              '<div class="rp-param"><span class="rp-param-l">Дата</span><span class="rp-param-v">' + fmtDate(d.monitoringDate) + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Сотрудник</span><span class="rp-param-v">' + escAttr(d.worker||'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Ширина B</span><span class="rp-param-v">' + (d.width!=null?d.width.toFixed(2)+' м':'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Метод v</span><span class="rp-param-v">' + escAttr(d.velMethod==='float'?'Поплавок':d.velMethod==='multi'?'По точкам':'Одна v') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">v, м/с</span><span class="rp-param-v">' + (d.velocity!=null?d.velocity.toFixed(3):'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">S, м²</span><span class="rp-param-v">' + (d.area!=null?d.area.toFixed(4):'—') + '</span></div>' +
              '<div class="rp-param rp-param--accent"><span class="rp-param-l">Q, м³/ч</span><span class="rp-param-v">' + (d.flowM3h!=null?d.flowM3h.toFixed(3):'—') + '</span></div>' +
              '<div class="rp-param"><span class="rp-param-l">Глубины</span><span class="rp-param-v">' + (Array.isArray(d.depths)?d.depths.map(function(h){return (h*100).toFixed(1)+'см';}).join(', '):'—') + '</span></div>' +
            '</div>' +
            (d.comment ? '<div class="rp-comment"><b>Комментарий:</b> ' + escAttr(d.comment) + '</div>' : '') +
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
    var cmpAI = ai.compare ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.compare) + '</div>' : '';
    var cmpRows = ptsB.map(function(pb) {
      var pa = ptsA.find(function(p){ return p.pointNumber===pb.pointNumber; });
      var qa = pa ? parseFloat(pa.flowRate)||0 : null;
      var qb = parseFloat(pb.flowRate)||0;
      var delta = qa!==null ? qb-qa : null;
      var pct   = (qa&&qa>0) ? (qb-qa)/qa*100 : null;
      var alert = delta!==null&&Math.abs(pct)>=30 ? (delta>0?'⚠ рост':'✓ снижение') : '';
      return '<tr class="' + (alert?'rp-row--alert':'') + '">' +
        '<td><b>' + escAttr(String(pb.pointNumber)) + '</b></td>' +
        '<td>' + escAttr(pb.domain||pb.domen||'—') + '</td>' +
        '<td>' + escAttr(pb.status||'—') + '</td>' +
        '<td>' + (qa!==null?qa.toFixed(2):'—') + '</td>' +
        '<td><b>' + qb.toFixed(2) + '</b></td>' +
        '<td class="' + (delta!==null?(delta>=0?'rp-up':'rp-down'):'') + '">' + (delta!==null?(delta>=0?'+':'')+delta.toFixed(2):'—') + '</td>' +
        '<td class="' + (pct!==null?(pct>=0?'rp-up':'rp-down'):'') + '">' + (pct!==null?(pct>=0?'+':'')+pct.toFixed(0)+'%':'—') + '</td>' +
        '<td>' + escAttr(alert) + '</td></tr>';
    }).join('');
    var cnSec = 5;
    compareSection = '<section class="rp-section"><h2>' + cnSec + '. Сравнение: ' + fmtDate(s.dateA) + ' (' + escAttr(s.weekA) + ') vs ' + fmtDate(s.dateB) + ' (' + escAttr(s.weekB) + ')</h2>' +
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
  var aiRec = ai.recommendations ? '<div class="rp-ai-text"><span class="rp-ai-badge">AI</span>' + renderAIText(ai.recommendations) + '</div>' : '';
  var concl = '<section class="rp-section"><h2>6. Заключение и рекомендации</h2>' +
    aiRec +
    (s.conclusions
      ? '<div class="rp-conclusion-text">' + escAttr(s.conclusions).replace(/\n/g,'<br>') + '</div>'
      : '<div class="rp-conclusion-text rp-conclusion-text--empty">Заключение не заполнено</div>') +
  '</section>';

  return '<!DOCTYPE html><html lang="ru"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Отчёт — Карьер ' + escHTML(s.quarryName || 'ЮРГ') + ' — ' + fmtDate(s.dateB) + '</title>' +
    '<style>' + getReportCSS(s.reportTheme, s.reportLayout) + '</style>' +
    (s.watermark ? '<style>body::before{content:"' + (s.watermark||'').replace(/"/g,'') + '";position:fixed;top:50%;left:50%;transform:translate(-50%,-50%) rotate(-45deg);font-size:80px;font-weight:900;color:rgba(150,0,0,0.06);pointer-events:none;z-index:9999;letter-spacing:8px;white-space:nowrap;}</style>' : '') +
    '</head><body>' +
    title +
    (function() {
      var dewateringSection = s.includeDewatering ? buildDewateringSection(s) : '';
      return '<div class="rp-body">' + summary + mapSection + domensSection + ditchesSection + dewateringSection + compareSection + concl + '</div>';
    })() +
    '<div class="rp-footer">' +
  '<div>Карьер ' + escHTML(s.quarryName || 'ЮРГ') + ' · Мониторинг подземных вод · ' + fmtDate(s.dateReport) + '</div>' +
  '<div style="text-align:center;color:#aaa">v' + s.reportVersion + '</div>' +
  '<div style="text-align:right">Стр. <span class="rp-page-counter"></span></div>' +
'</div>' +
    '<div class="rp-print-btn no-print">' +
      '<button onclick="window.print()">🖨 Печать / PDF</button>' +
      '<button onclick="window.close()" style="margin-left:8px">✕ Закрыть</button>' +
    '</div></body></html>';
}

// ── CSS отчёта ─────────────────────────────────────────────
function getThemeColors(theme) {
  var t = {
    blue:   { primary:'#1a73e8', dark:'#1a1a2e', light:'#e8f0fe', mid:'#1967d2', border:'#c8d8f5' },
    green:  { primary:'#16a34a', dark:'#14532d', light:'#dcfce7', mid:'#15803d', border:'#a7d7b5' },
    mono:   { primary:'#475569', dark:'#1e293b', light:'#f1f5f9', mid:'#334155', border:'#cbd5e1' },
    red:    { primary:'#ea580c', dark:'#7c2d12', light:'#ffedd5', mid:'#c2410c', border:'#fcc49a' },
    violet: { primary:'#7c3aed', dark:'#4c1d95', light:'#ede9fe', mid:'#6d28d9', border:'#c4b5fd' },
  };
  return t[theme] || t.blue;
}

function getReportCSS(theme, layout) {
  var c = getThemeColors(theme);
  return [
  '* { box-sizing: border-box; margin: 0; padding: 0; }',
  'body { font-family: Arial, sans-serif; font-size: 12px; color: #222; background: #fff; line-height: 1.5; }',
  '.rp-title-page { display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:40px;border-bottom:3px solid ' + c.primary + ';page-break-after:always; }',
  '.rp-title-logo { width:56px;height:56px;border-radius:50%;background:' + c.primary + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;margin:0 auto 14px; }',
  '.rp-title-logo-img { width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 14px;display:block;border:2px solid ' + c.border + '; }',
  '.rp-title-main { font-size:22px;font-weight:700;color:' + c.dark + ';margin-bottom:8px; }',
  '.rp-title-sub  { font-size:13px;color:#555;margin-bottom:14px; }',
  '.rp-title-period { background:' + c.light + ';border-radius:6px;padding:8px 20px;font-size:13px;color:' + c.primary + ';font-weight:500;margin-bottom:18px; }',
  '.rp-title-meta { font-size:12px;color:#444;line-height:1.8; }',
  '.rp-signature-block { margin-top:24px;padding-top:20px;border-top:1px dashed #dee2e6;width:100%; }',
  '.rp-sig-line { font-size:13px;color:#222;margin-bottom:4px; }',
  '.rp-sig-label { font-size:11px;color:#555;font-weight:600; }',
  '.rp-sig-role { font-size:10px;color:#888; }',
  '.rp-body { max-width:860px;margin:0 auto;padding:20px 30px; }',
  '.rp-section { margin-bottom:24px; }',
  '.rp-section h2 { font-size:14px;font-weight:700;color:' + c.dark + ';padding:5px 0;border-bottom:2px solid ' + c.primary + ';margin-bottom:12px; }',
  '.rp-section-sub { font-size:12px;font-weight:600;color:#444;margin:12px 0 6px; }',
  '.rp-kpi-grid { display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:10px; }',
  '.rp-kpi { background:#f8f9fa;border-radius:6px;padding:10px 12px;border:1px solid #e9ecef; }',
  '.rp-kpi-val { font-size:20px;font-weight:700;color:' + c.primary + ';line-height:1.2; }',
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
  '.rp-domen-name { font-weight:700;font-size:13px;color:' + c.dark + '; }',
  '.rp-domen-badge { background:' + c.light + ';color:' + c.mid + ';font-size:10px;padding:1px 7px;border-radius:10px;font-weight:500; }',
  '.rp-domen-q { font-size:12px;color:#444;margin-left:auto; }',
  '.rp-delta { font-size:11px;font-weight:600;padding:1px 6px;border-radius:3px; }',
  '.rp-delta.up { color:#d93025;background:#fce8e6; } .rp-delta.down { color:#188038;background:#e6f4ea; }',
  '.rp-ditch-block { border:1px solid #dee2e6;border-radius:6px;margin-bottom:16px;overflow:hidden; }',
  '.rp-ditch-header { display:flex;align-items:center;gap:8px;background:' + c.light + ';padding:7px 12px;border-bottom:1px solid ' + c.border + '; }',
  '.rp-ditch-icon { font-size:16px;color:' + c.primary + '; }',
  '.rp-ditch-name { font-weight:700;font-size:13px;color:' + c.dark + '; }',
  '.rp-ditch-status { background:' + c.primary + ';color:#fff;font-size:10px;padding:1px 7px;border-radius:10px;margin-left:auto; }',
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
  '.rp-photo-comment { font-size:11px;color:#444;background:#f8f9fa;border-left:3px solid ' + c.primary + ';border-radius:0 4px 4px 0;padding:6px 8px;line-height:1.5; }',
  '.rp-photo-comment--empty { color:#aaa;font-style:italic;border-left-color:#dee2e6; }',
  '.rp-ai-text { background:#f3f0ff;border-left:3px solid #7f77dd;border-radius:0 5px 5px 0;padding:8px 12px;margin-bottom:10px;font-size:12px;color:#333;line-height:1.6; }',
  '.rp-ai-badge { display:inline-block;background:#7f77dd;color:#fff;font-size:9px;font-weight:700;padding:1px 6px;border-radius:3px;margin-right:6px;letter-spacing:.05em; }',
  '.rp-map-wrap { margin-top:10px; }',
  '.rp-map-caption { font-size:10px;color:#888;text-align:center;margin-top:4px;font-style:italic; }',
  '.rp-conclusion-text { background:#f8f9fa;border-radius:5px;padding:10px 14px;font-size:12px;line-height:1.7;color:#333;white-space:pre-wrap; }',
  '.rp-conclusion-text--empty { color:#aaa;font-style:italic; }',
  '.rp-footer { display:flex;justify-content:space-between;max-width:860px;margin:20px auto 0;padding:12px 30px;font-size:10px;color:#aaa;border-top:1px solid #e9ecef; }',
  '.rp-section { counter-increment: section; }',
  '.rp-print-btn { position:fixed;bottom:20px;right:20px;z-index:100; }',
  '.rp-print-btn button { padding:10px 20px;font-size:13px;cursor:pointer;background:' + c.primary + ';color:#fff;border:none;border-radius:6px;font-weight:500; }',
  // ── Layout B: Dashboard body ──
  (layout === 'b' || layout === 'ab'
    ? 'body { background: #f1f5f9; }'
    : ''),

  // ── Title page: Variant A (default) ──
  '.rp-title-logo-img { max-width:200px;max-height:80px;width:auto;height:auto;border-radius:8px;object-fit:contain;margin:0 auto 16px;display:block; }',

  // ── Title A/AB ──
  '.rp-title-a { background:linear-gradient(135deg,#0d2137 0%,#1a3a5c 60%,#0f4c81 100%);color:#fff;padding:0;page-break-after:always; }',
  '.rp-title-a-content { display:flex;gap:28px;align-items:flex-start;padding:40px 48px 32px; }',
  '.rp-title-body { flex:1; }',
  '.rp-title-org { font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:rgba(255,255,255,.5);margin-bottom:10px; }',
  '.rp-title-main { font-size:24px;font-weight:700;color:#fff;line-height:1.25;margin-bottom:6px; }',
  '.rp-title-sub { font-size:13px;color:rgba(255,255,255,.65);margin-bottom:16px; }',
  '.rp-title-period { display:inline-block;background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.2);border-radius:8px;padding:7px 16px;font-size:12px;color:#fff;margin-bottom:14px; }',
  '.rp-title-meta { font-size:11px;color:rgba(255,255,255,.6);line-height:1.9; }',
  '.rp-title-meta b { color:#fff; }',
  '.rp-title-logo { width:64px;height:64px;border-radius:10px;background:rgba(255,255,255,.15);color:#fff;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;flex-shrink:0; }',

  // ── Title B ──
  '.rp-title-b { page-break-after:always; }',
  '.rp-title-b-topbar { background:#0f172a;padding:16px 32px;display:flex;align-items:center;gap:18px; }',
  '.rp-title-b-logo { background:linear-gradient(135deg,#1a73e8,#0d47a1);padding:6px 14px;border-radius:6px;font-size:15px;font-weight:900;color:#fff; }',
  '.rp-title-b-org-label { font-size:10px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em; }',
  '.rp-title-b-org-name { font-size:14px;font-weight:600;color:#fff; }',
  '.rp-title-b-vnum-label { font-size:9px;color:rgba(255,255,255,.3);text-transform:uppercase; }',
  '.rp-title-b-vnum { font-size:16px;font-weight:700;color:#60a5fa; }',
  '.rp-title-b-bottom { padding:20px 32px;background:#fff;border-bottom:1px solid #e2e8f0; }',
  '.rp-title-b-h1 { font-size:20px;font-weight:700;color:#0f172a;margin-bottom:10px; }',
  '.rp-title-b-chips { display:flex;gap:10px;flex-wrap:wrap; }',
  '.rp-title-b-chip { background:#f1f5f9;border:1px solid #e2e8f0;border-radius:8px;padding:7px 14px;font-size:12px;color:#475569; }',
  '.rp-title-b-chip--blue { background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8; }',

  // ── Title C ──
  '.rp-title-c { page-break-after:always;font-family:\'Times New Roman\',Georgia,serif; }',
  '.rp-lh-top { display:grid;grid-template-columns:auto 1fr auto;gap:18px;align-items:center;padding:20px 40px;border-bottom:3px double #8b1a1a; }',
  '.rp-lh-logo-box { width:64px;height:64px;border:2px solid #8b1a1a;display:flex;align-items:center;justify-content:center;font-size:18px;font-weight:700;font-family:Arial,sans-serif;color:#8b1a1a; }',
  '.rp-lh-org { text-align:center; }',
  '.rp-lh-org-name { font-size:14px;font-weight:700;color:#8b1a1a;text-transform:uppercase;letter-spacing:.04em; }',
  '.rp-lh-org-sub { font-size:11px;color:#555;margin-top:4px; }',
  '.rp-lh-docnum { text-align:right;font-size:11px;color:#555; }',
  '.rp-lh-num { font-size:16px;font-weight:700;color:#8b1a1a;font-family:Arial,sans-serif; }',
  '.rp-lh-date { font-size:10px;color:#888;margin-top:4px; }',
  '.rp-lh-title-block { padding:28px 40px;text-align:center;border-bottom:1px solid #ccc; }',
  '.rp-lh-doctype { font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:#888;margin-bottom:8px; }',
  '.rp-lh-main { font-size:20px;font-weight:700;color:#1c1c1c;line-height:1.35;margin-bottom:10px; }',
  '.rp-lh-period-box { display:inline-block;border:1px solid #8b1a1a;padding:6px 18px;font-size:12px;color:#8b1a1a; }',
  '.rp-lh-signers { display:grid;grid-template-columns:1fr 1fr;gap:40px;padding:16px 40px;border-bottom:2px solid #1c1c1c; }',
  '.rp-lh-role { font-size:10px;text-transform:uppercase;letter-spacing:.06em;color:#888;margin-bottom:4px; }',
  '.rp-lh-line { border-bottom:1px solid #1c1c1c;min-height:22px;margin-bottom:3px; }',
  '.rp-lh-name { font-size:11px;color:#555; }',

  // ── KPI-cards (layout B and AB) ──
  '.rp-kpi-cards { display:grid;grid-template-columns:repeat(5,1fr);gap:10px;margin-bottom:16px; }',
  '.rp-kpi-card { border-radius:10px;padding:14px 14px;border:1px solid #e2e8f0;background:#fff;position:relative;overflow:hidden; }',
  '.rp-kpi-card::before { content:"";position:absolute;top:0;left:0;right:0;height:3px; }',
  '.rp-kpi-card--blue::before   { background:#3b82f6; }',
  '.rp-kpi-card--red::before    { background:#ef4444; }',
  '.rp-kpi-card--green::before  { background:#22c55e; }',
  '.rp-kpi-card--green2::before { background:#22c55e; }',
  '.rp-kpi-card--amber::before  { background:#f59e0b; }',
  '.rp-kpi-card--purple::before { background:#8b5cf6; }',
  '.rp-kpi-card-icon { font-size:18px;margin-bottom:6px; }',
  '.rp-kpi-card-val  { font-size:18px;font-weight:800;color:#0f172a;line-height:1;margin-bottom:3px; }',
  '.rp-kpi-card-lbl  { font-size:9px;color:#94a3b8;text-transform:uppercase;letter-spacing:.04em; }',
  '.rp-kpi-card-sub  { font-size:10px;color:#64748b;margin-top:4px;font-weight:500; }',

  // ── KPI-compare (layout A and C) ──
  '.rp-kpi-compare { display:grid;grid-template-columns:1fr auto 1fr;gap:10px;align-items:start;margin-bottom:16px; }',
  '.rp-kpi-compare-week { background:#f8f9fa;border:1px solid #dee2e6;border-radius:8px;padding:10px 12px; }',
  '.rp-kpi-compare-week--b { border-color:#1a73e8;border-width:2px; }',
  '.rp-kpi-compare-label { font-size:10px;text-transform:uppercase;letter-spacing:.05em;color:#888;margin-bottom:8px; }',
  '.rp-kpi-grid2 { display:grid;grid-template-columns:1fr 1fr;gap:6px; }',
  '.rp-kpi-arrow { display:flex;flex-direction:column;align-items:center;gap:6px;padding-top:20px; }',

  // ── Layout C body overrides ──
  (layout === 'c'
    ? [
      '.rp-body { font-family: \'Times New Roman\',Georgia,serif; }',
      '.rp-section h2 { font-family: \'Times New Roman\',Georgia,serif; border-bottom: 1px solid #ccc; border-width: 1px; }',
      '.rp-table th { background:#f4f4f4;border:1px solid #ccc; }',
      '.rp-table td { border:1px solid #ccc; }',
      '.rp-footer { border-top:2px solid #1c1c1c; }',
    ].join('\n')
    : ''),

  '@media print {',
  '  @page { margin:15mm 18mm; size:A4 portrait; }',
  '  @page { @bottom-right { content: "Стр. " counter(page); font-size:9pt; color:#aaa; font-family:sans-serif; } }',
  '  body { counter-reset: page; }',
  '  .rp-section { counter-increment: page; }',
  '  .no-print { display:none !important; }',
  '  body { font-size:11px; }',
  '  * { -webkit-print-color-adjust:exact;print-color-adjust:exact; }',
  '  .rp-title-page { page-break-after:always; }',
  '  .rp-body { padding:0 !important;max-width:100% !important; }',
  '  .rp-domen-block,.rp-ditch-block,.rp-photo-row,.rp-kpi-grid { page-break-inside:avoid;break-inside:avoid; }',
  '  .rp-photo-img-wrap { flex:0 0 200px !important; }',
  '  .rp-photo-img { width:200px !important;height:150px !important; }',
  '  .rp-map-wrap img,.rp-ditch-block img { max-width:100% !important;height:auto !important;max-height:220px !important; }',
  '  .rp-page-counter::before { content: counter(page); }',
  '}'
  ].join('\n');
}
