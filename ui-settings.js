/**
 * ui-settings.js — страница настроек: схемы, цвета карты.
 * Извлечено из app.js.
 * Зависит от: ui-utils.js, Schemes, MapModule, Domens, Storage, Api
 */

var MAP_STYLE_STORAGE_KEY = 'gm_map_style_cfg';

// ── Инициализация настроек ────────────────────────────────

function initSettings() {
  refreshSchemesData();
  renderSettingsColors();
  initSettingsTabs();

  var fileInput = document.getElementById('scheme-file');
  if (fileInput && !fileInput._bound) {
    fileInput._bound = true;
    fileInput.addEventListener('change', function() {
      var file    = fileInput.files && fileInput.files[0];
      var preview = document.getElementById('scheme-preview');
      if (!preview) return;
      if (!file) { preview.innerHTML = ''; return; }
      var url = URL.createObjectURL(file);
      var img = document.createElement('img');
      img.src = url;
      img.onload = function() { URL.revokeObjectURL(url); };
      preview.innerHTML = '';
      preview.appendChild(img);
    });
  }

  var uploadBtn = document.getElementById('btn-upload-scheme');
  if (uploadBtn && !uploadBtn._bound) {
    uploadBtn._bound = true;
    uploadBtn.addEventListener('click', uploadScheme);
  }
}

function refreshSchemesData() {
  renderSettingsSchemes();
  if (typeof Schemes === 'undefined' || !Schemes.load) return;
  Schemes.load().then(function() {
    renderSettingsSchemes();
    renderMapSchemeSelector();
    if (AppState.currentTab === 'map') {
      _mapSchemeImg = null;
      renderMap();
    }
  }).catch(function() {
    renderSettingsSchemes();
  });
}

// ── Вкладки настроек ─────────────────────────────────────

function initSettingsTabs() {
  var tabs = document.querySelectorAll('[data-settings-tab]');
  if (!tabs || !tabs.length) return;
  tabs.forEach(function(btn) {
    if (btn._bound) return;
    btn._bound = true;
    btn.addEventListener('click', function() {
      switchSettingsTab(btn.dataset.settingsTab || 'main');
    });
  });
  var hasActive = document.querySelector('[data-settings-tab].active');
  if (!hasActive) switchSettingsTab('main');
}

function switchSettingsTab(name) {
  var tabName = name || 'main';

  // Кнопки вкладок
  document.querySelectorAll('[data-settings-tab]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.settingsTab === tabName);
  });

  // Панели — сначала скрываем все, потом показываем нужную
  ['settings-panel-main', 'settings-panel-legend', 'settings-panel-aliases', 'settings-panel-horizons', 'settings-panel-sync'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activePanel = document.getElementById('settings-panel-' + tabName);
  if (activePanel) activePanel.classList.add('active');

  if (tabName === 'aliases')   renderSettingsAliases();
  if (tabName === 'horizons')  renderSettingsHorizons();
  if (tabName === 'sync')      renderSettingsSync();
  if (tabName === 'theme')     renderSettingsTheme();
}

// ── Менеджер псевдонимов (вкладка "Связать точки") ────────

var ALIAS_KEY = 'gm_point_aliases';

function getAliases() {
  try { return JSON.parse(localStorage.getItem(ALIAS_KEY) || '{}'); }
  catch(e) { return {}; }
}
function saveAliases(obj) {
  localStorage.setItem(ALIAS_KEY, JSON.stringify(obj));
}

function renderSettingsAliases() {
  var wrap = document.getElementById('settings-alias-manager');
  if (!wrap) return;

  var aliases = getAliases();
  var allNums = [];
  if (typeof Points !== 'undefined') {
    Points.getList().forEach(function(p) {
      if (p.pointNumber && allNums.indexOf(String(p.pointNumber)) < 0)
        allNums.push(String(p.pointNumber));
    });
  }
  allNums.sort(function(a,b) {
    var na=parseFloat(a), nb=parseFloat(b);
    return (isNaN(na)||isNaN(nb)) ? a.localeCompare(b) : na-nb;
  });

  var aliasKeys = Object.keys(aliases);
  var html = '<p class="form-hint" style="margin-bottom:14px">Если одно место водопроявления фиксировалось под разными номерами — объедини их в группу. Группа появится в выборе точки на вкладке "История".</p>';

  // Существующие группы
  if (aliasKeys.length) {
    aliasKeys.forEach(function(name) {
      var nums = aliases[name];
      html += '<div class="alias-group-card">' +
        '<div class="alias-group-header">' +
          '<span class="alias-group-icon">🔗</span>' +
          '<span class="alias-group-name">' + escAttr(name) + '</span>' +
          '<button class="btn btn-sm btn-danger alias-del-btn" data-name="' + escAttr(name) + '">Удалить</button>' +
        '</div>' +
        '<div class="alias-group-nums">' +
          nums.map(function(n) {
            return '<span class="alias-num-tag">№' + escAttr(n) + '</span>';
          }).join('') +
        '</div>' +
      '</div>';
    });
  } else {
    html += '<p class="form-hint" style="margin-bottom:16px;color:var(--txt-3)">Групп пока нет</p>';
  }

  // Форма создания
  html += '<div class="alias-new-form">' +
    '<div class="form-group">' +
      '<label class="form-label">Название группы</label>' +
      '<input id="alias-name-inp" type="text" class="form-input" placeholder="Например: Борт СВ-3 или Точка А">' +
    '</div>' +
    '<div class="form-group">' +
      '<label class="form-label">Выберите точки для объединения</label>' +
      '<div class="alias-checkboxes">' +
        allNums.map(function(n) {
          return '<label class="alias-cb-label">' +
            '<input type="checkbox" class="alias-num-cb" value="' + escAttr(n) + '"> №' + escAttr(n) +
          '</label>';
        }).join('') +
      '</div>' +
    '</div>' +
    '<button id="alias-save-btn" class="btn btn-primary">🔗 Сохранить группу</button>' +
  '</div>';

  wrap.innerHTML = html;

  // Удаление
  wrap.querySelectorAll('.alias-del-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var name = this.dataset.name;
      if (!confirm('Удалить группу "' + name + '"?')) return;
      var a = getAliases(); delete a[name]; saveAliases(a);
      renderSettingsAliases();
    });
  });

  // Сохранение
  var saveBtn = document.getElementById('alias-save-btn');
  if (saveBtn) saveBtn.addEventListener('click', function() {
    var name = (document.getElementById('alias-name-inp').value || '').trim();
    if (!name) { alert('Введите название группы'); return; }
    var checked = [];
    wrap.querySelectorAll('.alias-num-cb:checked').forEach(function(cb) { checked.push(cb.value); });
    if (checked.length < 2) { alert('Выберите минимум 2 точки'); return; }
    var a = getAliases(); a[name] = checked; saveAliases(a);
    renderSettingsAliases();
    var msg = document.createElement('p');
    msg.className = 'form-hint'; msg.style.color = '#34a853';
    msg.textContent = '✅ Группа "' + name + '" сохранена';
    saveBtn.parentNode.appendChild(msg);
    setTimeout(function() { if(msg.parentNode) msg.parentNode.removeChild(msg); }, 3000);
  });
}

// ── Схемы ─────────────────────────────────────────────────

function renderSettingsSchemes() {
  var weekEl              = document.getElementById('settings-week-key');
  if (weekEl) weekEl.textContent = Schemes.formatWeekKey(Schemes.currentWeekKey());
  var container           = document.getElementById('settings-schemes-list');
  var activeEl            = document.getElementById('settings-active-scheme');
  var currentWeekStatusEl = document.getElementById('settings-current-week-status');
  if (!container) return;

  var schemes = Schemes.getList().slice().sort(function(a, b) {
    var aW = a.weekKey || '', bW = b.weekKey || '';
    if (aW !== bW) return aW > bW ? -1 : 1;
    var aAt = a.uploadedAt || '', bAt = b.uploadedAt || '';
    return aAt > bAt ? -1 : (aAt < bAt ? 1 : 0);
  });
  var current      = Schemes.currentWeekKey();
  var activeScheme = Schemes.getCurrent();
  var cwScheme     = Schemes.getByWeek(current);

  if (!schemes.length) {
    container.innerHTML = '<p class="form-hint">Схем пока нет</p>';
    if (activeEl)            activeEl.textContent = '';
    if (currentWeekStatusEl) currentWeekStatusEl.textContent = 'Статус текущей недели: схема не загружена';
    return;
  }

  if (currentWeekStatusEl) {
    if (cwScheme) {
      currentWeekStatusEl.textContent = 'Статус текущей недели: схема загружена';
    } else if (activeScheme) {
      currentWeekStatusEl.textContent = 'Статус текущей недели: нет, используется ' + Schemes.formatWeekKey(activeScheme.weekKey);
    } else {
      currentWeekStatusEl.textContent = 'Статус текущей недели: схема не загружена';
    }
  }

  if (activeEl) {
    if (activeScheme) {
      var currentHit = activeScheme.weekKey === current;
      activeEl.textContent = 'Активная схема: ' + Schemes.formatWeekKey(activeScheme.weekKey) +
        (currentHit ? ' (текущая неделя)' : ' (последняя доступная)');
    } else {
      activeEl.textContent = '';
    }
  }

  var html = '';
  for (var i = 0; i < schemes.length; i++) {
    var s     = schemes[i];
    var label = s.weekKey ? Schemes.formatWeekKey(s.weekKey) : 'Без недели';
    html += '<div class="scheme-item">';
    html += '<div><div class="scheme-item__week">' + label + '</div>';
    html += '<div class="scheme-item__date">' + (s.uploadedAt ? formatDate(s.uploadedAt) : '—') + '</div></div>';
    if (s.weekKey === current) html += '<span class="scheme-item__current">✅ Текущая</span>';
    else if (activeScheme && s.weekKey === activeScheme.weekKey) html += '<span class="scheme-item__current">📌 Активная</span>';
    html += '</div>';
  }
  container.innerHTML = html;
}

function uploadScheme() {
  var fileInput = document.getElementById('scheme-file');
  var statusEl  = document.getElementById('scheme-upload-status');
  var file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) { alert('Выберите файл схемы'); return; }
  var weekKey   = Schemes.currentWeekKey();
  var uploadBtn = document.getElementById('btn-upload-scheme');
  if (statusEl)  statusEl.textContent = '⏳ Загрузка...';
  if (uploadBtn) uploadBtn.disabled = true;
  var stid = Toast.progress('scheme-upload', 'Загрузка схемы карьера...', 30);

  Schemes.upload(file, weekKey, Storage.getDeviceId()).then(function() {
    if (statusEl)  statusEl.textContent = '✅ Схема загружена';
    Toast.done('scheme-upload', 'Схема карьера загружена');
    if (fileInput) fileInput.value = '';
    var preview = document.getElementById('scheme-preview');
    if (preview) preview.innerHTML = '';
    return Schemes.load();
  }).then(function() {
    renderSettingsSchemes();
    _mapSchemeImg = null;
    if (AppState.currentTab === 'map') renderMap();
  }).catch(function(err) {
    if (statusEl) statusEl.textContent = '❌ ' + err.message;
    Toast.fail('scheme-upload', 'Ошибка загрузки схемы');
  }).then(function() {
    if (uploadBtn) uploadBtn.disabled = false;
  });
}

// ── Цвета карты ───────────────────────────────────────────

function loadMapStyleSettings() {
  try {
    var raw = localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    if (!raw || typeof MapModule === 'undefined') return;
    var cfg = JSON.parse(raw);
    if (cfg.intensityColors && cfg.intensityColors.marker && !cfg.intensityColor) {
      cfg.intensityColor = cfg.intensityColors.marker;
    }
    MapModule.setStyleConfig(cfg);
    if (typeof Domens !== 'undefined' && Domens.setColors && cfg.domainColors) {
      Domens.setColors(cfg.domainColors);
    }
  } catch(e) {
    console.warn('Не удалось загрузить настройки цветов карты:', e);
  }
}

function renderSettingsColors() {
  if (typeof MapModule === 'undefined') return;
  var cfg          = MapModule.getStyleConfig() || {};
  var statusColors = cfg.statusColors  || {};
  var domainColors = cfg.domainColors  || {};

  function bindColor(id, val) {
    var el = document.getElementById(id);
    if (el) el.value = val || '#888888';
  }
  function bindSwatch(inputId, swatchId) {
    var input  = document.getElementById(inputId);
    var swatch = document.getElementById(swatchId);
    if (!input || !swatch) return;
    swatch.style.background = input.value || '#888888';
    if (!input._swatchBound) {
      input._swatchBound = true;
      input.addEventListener('input', function() { swatch.style.background = input.value || '#888888'; });
    }
  }

  bindColor('set-status-new',     statusColors['Новая']);
  bindColor('set-status-active',  statusColors['Активная']);
  bindColor('set-status-fading',  statusColors['Иссякает']);
  bindColor('set-status-dry',       statusColors['Пересохла']);
  bindColor('set-status-flood',     statusColors['Паводковая']);
  bindColor('set-status-overflow',  statusColors['Перелив']);
  bindColor('set-intensity-color', cfg.intensityColor);
  bindColor('set-domain-1', domainColors['Domen-1']);
  bindColor('set-domain-2', domainColors['Domen-2']);
  bindColor('set-domain-3', domainColors['Domen-3']);
  bindColor('set-domain-4', domainColors['Domen-4']);
  bindColor('set-domain-5', domainColors['Domen-5']);

  bindSwatch('set-status-new',      'swatch-status-new');
  bindSwatch('set-status-active',   'swatch-status-active');
  bindSwatch('set-status-fading',   'swatch-status-fading');
  bindSwatch('set-status-dry',       'swatch-status-dry');
  bindSwatch('set-status-flood',     'swatch-status-flood');
  bindSwatch('set-status-overflow',  'swatch-status-overflow');
  bindSwatch('set-intensity-color', 'swatch-intensity');
  bindSwatch('set-domain-1', 'swatch-domain-1');
  bindSwatch('set-domain-2', 'swatch-domain-2');
  bindSwatch('set-domain-3', 'swatch-domain-3');
  bindSwatch('set-domain-4', 'swatch-domain-4');
  bindSwatch('set-domain-5', 'swatch-domain-5');

  var btnStatus = document.getElementById('btn-save-status-colors');
  if (btnStatus) btnStatus._bound = false; // сбрасываем чтобы переинициализировать с новыми полями
  if (btnStatus && !btnStatus._bound) {
    btnStatus._bound = true;
    btnStatus.addEventListener('click', function() {
      var patch = {
        statusColors: {
          'Новая':     getField('set-status-new'),
          'Активная':  getField('set-status-active'),
          'Иссякает':    getField('set-status-fading'),
          'Искакает':    getField('set-status-fading'), // поддержка опечатки в старых данных
          'Пересохла':   getField('set-status-dry'),
          'Паводковая':  getField('set-status-flood'),
          'Перелив':     getField('set-status-overflow'),
        },
        intensityColor:    getField('set-intensity-color'),
        simpleColor:       getField('set-intensity-color'),
        combinedBaseColor: getField('set-intensity-color'),
      };
      applyMapStylePatch(patch);
      var msg = document.getElementById('map-color-save-msg');
      if (msg) msg.textContent = '✅ Цвета статусов сохранены';
    });
  }

  var btnDomain = document.getElementById('btn-save-domain-colors');
  if (btnDomain && !btnDomain._bound) {
    btnDomain._bound = true;
    btnDomain.addEventListener('click', function() {
      var patch = {
        domainColors: {
          'Domen-1': getField('set-domain-1'),
          'Domen-2': getField('set-domain-2'),
          'Domen-3': getField('set-domain-3'),
          'Domen-4': getField('set-domain-4'),
          'Domen-5': getField('set-domain-5'),
        },
      };
      applyMapStylePatch(patch);
      var msg = document.getElementById('map-domain-save-msg');
      if (msg) msg.textContent = '✅ Цвета доменов сохранены';
    });
  }
}

function applyMapStylePatch(patch) {
  if (typeof MapModule === 'undefined') return;
  var current = getSavedMapStyleSettings();
  var merged  = deepMerge(current, patch || {});
  if (merged.intensityColor && !merged.intensityColors) {
    merged.intensityColors = { marker: merged.intensityColor };
  }
  if (merged.intensityColors && merged.intensityColors.marker) {
    merged.intensityColor = merged.intensityColors.marker;
  }
  MapModule.setStyleConfig(merged);
  if (typeof Domens !== 'undefined' && Domens.setColors && merged.domainColors) {
    Domens.setColors(merged.domainColors);
  }
  localStorage.setItem(MAP_STYLE_STORAGE_KEY, JSON.stringify(merged));
  renderMapModeLegend();
  updateMapLegendPoints();
  if (_mapSchemeImg) redrawMap();
}

function getSavedMapStyleSettings() {
  try {
    var raw = localStorage.getItem(MAP_STYLE_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch(e) {
    return {};
  }
}

function deepMerge(target, patch) {
  var out = JSON.parse(JSON.stringify(target || {}));
  Object.keys(patch || {}).forEach(function(k) {
    if (patch[k] && typeof patch[k] === 'object' && !Array.isArray(patch[k])) {
      out[k] = deepMerge(out[k] || {}, patch[k]);
    } else {
      out[k] = patch[k];
    }
  });
  return out;
}

// ── Управление горизонтами ────────────────────────────────

function renderSettingsHorizons() {
  var wrap = document.getElementById('settings-horizons-manager');
  if (!wrap) return;

  var horizons = Storage.getHorizons();

  var html = '<p class="form-hint" style="margin-bottom:14px">Задай список горизонтов (уступов) карьера. Они появятся в выпадающем списке при добавлении и редактировании точки.</p>';

  // Существующие горизонты — редактируемый список
  if (horizons.length) {
    html += '<div id="horizons-list" style="margin-bottom:14px">';
    horizons.forEach(function(h, i) {
      html +=
        '<div class="alias-group-card" style="padding:8px 12px;margin-bottom:6px;display:flex;align-items:center;gap:8px">' +
          '<span style="font-size:13px;flex:1;color:var(--txt-1)">⛰️ ' + escAttr(h) + '</span>' +
          '<button class="btn btn-sm btn-danger horizon-del-btn" data-idx="' + i + '" style="padding:3px 10px">Удалить</button>' +
        '</div>';
    });
    html += '</div>';
  } else {
    html += '<p class="form-hint" style="color:var(--txt-3);margin-bottom:14px">Горизонты не заданы</p>';
  }

  // Форма добавления
  html +=
    '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">' +
      '<input id="horizon-new-inp" type="text" class="form-input" placeholder="Напр.: +240 или Гор. 220" style="flex:1;min-width:160px">' +
      '<button id="horizon-add-btn" class="btn btn-primary" style="white-space:nowrap">+ Добавить</button>' +
    '</div>' +
    '<p class="form-hint" style="margin-top:8px">Примеры: +240, +220, Гор. 200, Уступ 5</p>';

  wrap.innerHTML = html;

  // Удаление
  wrap.querySelectorAll('.horizon-del-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var idx = parseInt(this.dataset.idx);
      var list = Storage.getHorizons();
      list.splice(idx, 1);
      Storage.saveHorizons(list);
      renderSettingsHorizons();
    });
  });

  // Добавление
  var addBtn = document.getElementById('horizon-add-btn');
  var inp    = document.getElementById('horizon-new-inp');
  function addHorizon() {
    var val = (inp ? inp.value.trim() : '');
    if (!val) { alert('Введите название горизонта'); return; }
    var list = Storage.getHorizons();
    if (list.indexOf(val) >= 0) { alert('Такой горизонт уже есть'); return; }
    list.push(val);
    Storage.saveHorizons(list);
    if (inp) inp.value = '';
    renderSettingsHorizons();
    Toast.show('Горизонт «' + val + '» добавлен', 'success');
  }
  if (addBtn) addBtn.addEventListener('click', addHorizon);
  if (inp) inp.addEventListener('keydown', function(e) {
    if (e.key === 'Enter') { e.preventDefault(); addHorizon(); }
  });
}

// ── Настройки синхронизации ───────────────────────────────

function renderSettingsSync() {
  var wrap = document.getElementById('settings-sync-manager');
  if (!wrap) return;

  var currentMs  = Storage.getSyncInterval();
  var currentSec = Math.round(currentMs / 1000);

  var OPTIONS = [
    { label: '15 секунд',  ms: 15000  },
    { label: '30 секунд',  ms: 30000  },
    { label: '1 минута',   ms: 60000  },
    { label: '2 минуты',   ms: 120000 },
    { label: '5 минут',    ms: 300000 },
    { label: '10 минут',   ms: 600000 },
  ];

  var html = '<p class="form-hint" style="margin-bottom:14px">Как часто приложение автоматически синхронизирует данные с Google Sheets. Более редкая синхронизация снижает нагрузку на сеть.</p>';

  html += '<div class="form-group" style="max-width:320px">' +
    '<label class="form-label" for="sync-interval-sel">Интервал автосинхронизации</label>' +
    '<select id="sync-interval-sel" class="form-select">';

  OPTIONS.forEach(function(o) {
    html += '<option value="' + o.ms + '"' + (o.ms === currentMs ? ' selected' : '') + '>' + o.label + '</option>';
  });

  html += '</select></div>';

  html += '<div style="display:flex;align-items:center;gap:12px;margin-top:4px">' +
    '<button id="sync-interval-save" class="btn btn-primary">Сохранить</button>' +
    '<span id="sync-interval-msg" style="font-size:13px;color:var(--txt-3)">Текущий: каждые ' + currentSec + ' сек.</span>' +
  '</div>';

  html += '<div style="margin-top:20px;padding-top:16px;border-top:1px solid var(--line)">' +
    '<p class="form-hint" style="margin-bottom:10px">Ручная синхронизация:</p>' +
    '<button id="sync-now-settings" class="btn btn-outline">🔄 Синхронизировать сейчас</button>' +
  '</div>';

  wrap.innerHTML = html;

  var saveBtn = document.getElementById('sync-interval-save');
  var msg     = document.getElementById('sync-interval-msg');
  var sel     = document.getElementById('sync-interval-sel');
  var syncNow = document.getElementById('sync-now-settings');

  if (saveBtn) saveBtn.addEventListener('click', function() {
    var ms  = parseInt(sel.value);
    var sec = Math.round(ms / 1000);
    Storage.saveSyncInterval(ms);
    if (typeof window.restartSyncTimer === 'function') window.restartSyncTimer();
    if (msg) msg.textContent = 'Текущий: каждые ' + sec + ' сек.';
    Toast.show('Интервал синхронизации сохранён: ' + sel.options[sel.selectedIndex].text, 'success');
  });

  if (syncNow) syncNow.addEventListener('click', function() {
    if (typeof syncAll === 'function') syncAll();
  });
}

// ── Тема — рендер панели ─────────────────────────────────
function renderSettingsTheme() {
  var panel = document.getElementById('settings-panel-theme');
  if (!panel) return;
  var saved = '';
  try { saved = localStorage.getItem('app-theme') || 'default'; } catch(e) {}

  panel.innerHTML = '<div class="card" style="padding:16px">' +
    '<div class="card-label" style="margin-bottom:14px">Тема оформления</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px" id="theme-grid">' +
    [
      ['default',    '🌑', 'Тёмная',        '#0f1115', '#242b36'],
      ['anthracite', '⬛', 'Антрацит',       '#1a1a1a', '#363636'],
      ['blue',       '🔵', 'Blue Steel',     '#0a0e1a', '#162140'],
      ['mining',     '🟢', 'Mining',         '#0b1209', '#1c2c16'],
      ['light',      '☀️', 'Светлая',        '#f0f2f5', '#ffffff'],
    ].map(function(t) {
      var active = saved === t[0] ? 'active' : '';
      return '<button class="theme-btn ' + active + '" data-theme="' + t[0] + '" onclick="applyTheme(\'' + t[0] + '\',this)">' +
        '<div class="theme-preview" style="background:linear-gradient(135deg,' + t[3] + ',' + t[4] + ')"></div>' +
        '<span>' + t[1] + ' ' + t[2] + '</span>' +
      '</button>';
    }).join('') +
    '</div></div>';
}
