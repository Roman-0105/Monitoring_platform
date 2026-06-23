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

  // Show/hide users tab based on role
  var isAdmin = AppState.currentUser && AppState.currentUser.role === 'admin';
  var usersTabBtn = document.getElementById('btn-settings-tab-users');
  if (usersTabBtn) {
    usersTabBtn.style.display = isAdmin ? '' : 'none';
  }

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
  ['settings-panel-main', 'settings-panel-legend', 'settings-panel-sync', 'settings-panel-users', 'settings-panel-maps'].forEach(function(id) {
    var el = document.getElementById(id);
    if (el) el.classList.remove('active');
  });
  var activePanel = document.getElementById('settings-panel-' + tabName);
  if (activePanel) activePanel.classList.add('active');

  if (tabName === 'sync')      renderSettingsSync();
  if (tabName === 'theme')     renderSettingsTheme();
  if (tabName === 'users')     renderUsersPanel();
  if (tabName === 'maps')      renderQuarryMapsPanel();
}

// ── Схемы ─────────────────────────────────────────────────

function renderSettingsSchemes() {
  var weekEl = document.getElementById('settings-week-key');
  if (weekEl) weekEl.textContent = Schemes.formatWeekKey(Schemes.currentWeekKey());

  // Заполняем поле выбора недели текущей неделей по умолчанию
  var weekInput = document.getElementById('scheme-week-input');
  if (weekInput && !weekInput.value) weekInput.value = Schemes.currentWeekKey();
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
  var fileInput  = document.getElementById('scheme-file');
  var statusEl   = document.getElementById('scheme-upload-status');
  var weekInput  = document.getElementById('scheme-week-input');
  var file = fileInput && fileInput.files && fileInput.files[0];
  if (!file) { if (statusEl) statusEl.textContent = '❌ Выберите файл схемы'; return; }

  // Берём неделю из поля — если пусто, берём текущую
  var weekKey = (weekInput && weekInput.value) ? weekInput.value : Schemes.currentWeekKey();
  // Нормализуем: "2026-W07" → "2026-W07" (браузер может вернуть "2026-W7")
  weekKey = weekKey.replace(/W(\d)$/, 'W0$1');

  var uploadBtn = document.getElementById('btn-upload-scheme');
  if (statusEl) statusEl.textContent = '⏳ Загрузка ' + Schemes.formatWeekKey(weekKey) + '...';
  if (uploadBtn) uploadBtn.disabled = true;
  Toast.progress('scheme-upload', 'Загрузка схемы карьера...', 30);

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

// ── Управление пользователями (только для admin) ──────────

function renderUsersPanel() {
  var wrap = document.getElementById('settings-panel-users');
  if (!wrap) return;
  if (!AppState.currentUser || AppState.currentUser.role !== 'admin') {
    wrap.innerHTML = '';
    return;
  }

  wrap.innerHTML = '<div class="card"><div class="card-title">Пользователи системы</div>' +
    '<div id="users-panel-content"><p class="form-hint">Загрузка...</p></div>' +
    '<button class="btn btn-primary" id="btn-add-user" style="margin-top:12px">+ Добавить пользователя</button>' +
    '</div>';

  var addBtn = document.getElementById('btn-add-user');
  if (addBtn) addBtn.addEventListener('click', showAddUserModal);

  Auth.callAdminFunction({ action: 'list' }).then(function(data) {
    var users = data.users || [];
    var content = document.getElementById('users-panel-content');
    if (!content) return;

    if (!users.length) {
      content.innerHTML = '<p class="form-hint">Пользователей нет</p>';
      return;
    }

    var html = '<div style="overflow-x:auto"><table class="users-table" style="width:100%;border-collapse:collapse;font-size:13px">' +
      '<thead><tr style="border-bottom:1px solid var(--line)">' +
        '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Имя</th>' +
        '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Email</th>' +
        '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Роль</th>' +
        '<th style="text-align:left;padding:8px 10px;color:var(--txt-3);font-weight:500">Добавлен</th>' +
        '<th style="padding:8px 10px"></th>' +
      '</tr></thead><tbody>';

    users.forEach(function(u) {
      var isSelf = u.id === (AppState.currentUser && AppState.currentUser.id);
      var roleLabel = u.role === 'admin' ? '<span style="color:#1a73e8">admin</span>' : 'user';
      var createdDate = u.createdAt ? new Date(u.createdAt).toLocaleDateString('ru-RU') : '—';
      html += '<tr style="border-bottom:1px solid rgba(255,255,255,.05)">' +
        '<td style="padding:8px 10px">' + escHTML(u.displayName || '—') + '</td>' +
        '<td style="padding:8px 10px">' + escHTML(u.email || '') + '</td>' +
        '<td style="padding:8px 10px">' + roleLabel + '</td>' +
        '<td style="padding:8px 10px;color:var(--txt-3)">' + createdDate + '</td>' +
        '<td style="padding:8px 10px;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline user-edit-btn" data-uid="' + escHTML(u.id) + '" data-name="' + escHTML(u.displayName || '') + '" data-role="' + escHTML(u.role) + '" style="padding:3px 10px;margin-right:6px">✏ Изменить</button>' +
          (!isSelf ? '<button class="btn btn-sm btn-danger user-del-btn" data-uid="' + escHTML(u.id) + '" data-name="' + escHTML(u.displayName || u.email) + '" style="padding:3px 10px">Удалить</button>' : '') +
        '</td>' +
      '</tr>';
    });

    html += '</tbody></table></div>';
    content.innerHTML = html;

    content.querySelectorAll('.user-edit-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        showEditUserModal(this.dataset.uid, this.dataset.name, this.dataset.role);
      });
    });

    content.querySelectorAll('.user-del-btn').forEach(function(btn) {
      btn.addEventListener('click', function() {
        var uid  = this.dataset.uid;
        var name = this.dataset.name;
        if (!confirm('Удалить пользователя "' + name + '"?')) return;
        btn.disabled = true;
        Auth.callAdminFunction({ action: 'delete', userId: uid }).then(function() {
          Toast.show('Пользователь удалён', 'success');
          renderUsersPanel();
        }).catch(function(err) {
          Toast.show('Ошибка: ' + err.message, 'error');
          btn.disabled = false;
        });
      });
    });
  }).catch(function(err) {
    var content = document.getElementById('users-panel-content');
    if (content) content.innerHTML = '<p class="form-hint" style="color:var(--red)">Ошибка: ' + escHTML(err.message) + '</p>';
  });
}

function showAddUserModal() {
  var existing = document.getElementById('add-user-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'add-user-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:28px 24px;width:min(420px,92vw);border:1px solid rgba(255,255,255,.08)">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">',
        '<span style="font-size:16px;font-weight:600">Новый пользователь</span>',
        '<button id="add-user-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer;line-height:1">✕</button>',
      '</div>',
      '<div class="form-group" style="margin-bottom:14px">',
        '<label class="form-label">Имя (display_name)</label>',
        '<input id="nu-name" type="text" class="form-control" placeholder="Иванов И.И." style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:14px">',
        '<label class="form-label">Email</label>',
        '<input id="nu-email" type="email" class="form-control" placeholder="user@example.com" style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:14px">',
        '<label class="form-label">Пароль</label>',
        '<input id="nu-password" type="password" class="form-control" placeholder="Минимум 6 символов" style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:20px">',
        '<label class="form-label">Роль</label>',
        '<select id="nu-role" class="form-control" style="width:100%;box-sizing:border-box">',
          '<option value="user">user</option>',
          '<option value="admin">admin</option>',
        '</select>',
      '</div>',
      '<p id="nu-error" style="color:var(--red,#ea4335);font-size:13px;margin-bottom:10px;display:none"></p>',
      '<button id="nu-submit" class="btn btn-primary btn-full">Создать пользователя</button>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('add-user-close').addEventListener('click', function() { modal.remove(); });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

  document.getElementById('nu-submit').addEventListener('click', function() {
    var name     = (document.getElementById('nu-name').value || '').trim();
    var email    = (document.getElementById('nu-email').value || '').trim();
    var password = document.getElementById('nu-password').value;
    var role     = document.getElementById('nu-role').value;
    var errEl    = document.getElementById('nu-error');
    var submitBtn = document.getElementById('nu-submit');

    if (!name || !email || !password) {
      errEl.textContent = 'Все поля обязательны';
      errEl.style.display = '';
      return;
    }
    errEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Создание...';

    Auth.callAdminFunction({ action: 'create', email: email, password: password, displayName: name, role: role })
      .then(function() {
        modal.remove();
        Toast.show('Пользователь создан', 'success');
        renderUsersPanel();
      }).catch(function(err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Создать пользователя';
      });
  });
}

function showEditUserModal(uid, currentName, currentRole) {
  var existing = document.getElementById('edit-user-modal');
  if (existing) existing.remove();

  var modal = document.createElement('div');
  modal.id = 'edit-user-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:9000;display:flex;align-items:center;justify-content:center';
  modal.innerHTML = [
    '<div style="background:var(--card-bg,#1e2530);border-radius:14px;padding:28px 24px;width:min(420px,92vw);border:1px solid rgba(255,255,255,.08)">',
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">',
        '<span style="font-size:16px;font-weight:600">Редактировать пользователя</span>',
        '<button id="eu-close" style="background:none;border:none;color:var(--txt-2);font-size:22px;cursor:pointer;line-height:1">✕</button>',
      '</div>',
      '<div class="form-group" style="margin-bottom:14px">',
        '<label class="form-label">Имя (display_name)</label>',
        '<input id="eu-name" type="text" class="form-control" value="' + escHTML(currentName) + '" style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:14px">',
        '<label class="form-label">Новый пароль <span style="color:var(--txt-3);font-weight:400">(оставьте пустым, чтобы не менять)</span></label>',
        '<input id="eu-password" type="password" class="form-control" placeholder="Минимум 6 символов" style="width:100%;box-sizing:border-box">',
      '</div>',
      '<div class="form-group" style="margin-bottom:20px">',
        '<label class="form-label">Роль</label>',
        '<select id="eu-role" class="form-control" style="width:100%;box-sizing:border-box">',
          '<option value="user"' + (currentRole === 'user' ? ' selected' : '') + '>user</option>',
          '<option value="admin"' + (currentRole === 'admin' ? ' selected' : '') + '>admin</option>',
        '</select>',
      '</div>',
      '<p id="eu-error" style="color:var(--red,#ea4335);font-size:13px;margin-bottom:10px;display:none"></p>',
      '<button id="eu-submit" class="btn btn-primary btn-full">Сохранить изменения</button>',
    '</div>',
  ].join('');

  document.body.appendChild(modal);

  document.getElementById('eu-close').addEventListener('click', function() { modal.remove(); });
  modal.addEventListener('click', function(e) { if (e.target === modal) modal.remove(); });

  document.getElementById('eu-submit').addEventListener('click', function() {
    var name     = (document.getElementById('eu-name').value || '').trim();
    var password = document.getElementById('eu-password').value;
    var role     = document.getElementById('eu-role').value;
    var errEl    = document.getElementById('eu-error');
    var submitBtn = document.getElementById('eu-submit');

    if (!name) {
      errEl.textContent = 'Имя не может быть пустым';
      errEl.style.display = '';
      return;
    }
    if (password && password.length < 6) {
      errEl.textContent = 'Пароль должен быть не менее 6 символов';
      errEl.style.display = '';
      return;
    }
    errEl.style.display = 'none';
    submitBtn.disabled = true;
    submitBtn.textContent = 'Сохранение...';

    var payload = { action: 'update', userId: uid, displayName: name, role: role };
    if (password) payload.password = password;

    Auth.callAdminFunction(payload)
      .then(function() {
        modal.remove();
        Toast.show('Пользователь обновлён', 'success');
        renderUsersPanel();
      }).catch(function(err) {
        errEl.textContent = err.message;
        errEl.style.display = '';
        submitBtn.disabled = false;
        submitBtn.textContent = 'Сохранить изменения';
      });
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

// ── Карты карьеров ────────────────────────────────────────

function renderQuarryMapsPanel() {
  var panel = document.getElementById('settings-panel-maps');
  if (!panel) return;

  var quarries = (window.AppState && AppState.quarries) || [];
  if (!quarries.length) {
    panel.innerHTML = '<div class="card"><p class="form-hint" style="margin:0">Карьеры не загружены. Обновите страницу.</p></div>';
    return;
  }

  var html = '<p class="form-hint" style="margin-bottom:16px">Задайте реальные координаты углов карты для каждого карьера. ' +
    'Используйте ручной ввод или откалибруйте по двум точкам на схеме.</p>';

  quarries.forEach(function(q) {
    var ok = q.xMin != null && q.xMax != null;
    html += '<div class="card" style="margin-bottom:12px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">' +
        '<div class="card-title" style="margin:0">' + escHTML(q.name) + '</div>' +
        '<span style="font-size:11px;color:' + (ok ? '#4caf7d' : '#f9ab00') + '">' + (ok ? '✓ Настроена' : '⚠ Не настроена') + '</span>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:12px">' +
        '<div><label class="form-label">X min (Запад)</label>' +
          '<input type="number" id="qmap-xmin-' + q.id + '" class="form-control" value="' + (q.xMin != null ? q.xMin : '') + '" placeholder="45850"></div>' +
        '<div><label class="form-label">X max (Восток)</label>' +
          '<input type="number" id="qmap-xmax-' + q.id + '" class="form-control" value="' + (q.xMax != null ? q.xMax : '') + '" placeholder="47350"></div>' +
        '<div><label class="form-label">Y min (Юг)</label>' +
          '<input type="number" id="qmap-ymin-' + q.id + '" class="form-control" value="' + (q.yMin != null ? q.yMin : '') + '" placeholder="15800"></div>' +
        '<div><label class="form-label">Y max (Север)</label>' +
          '<input type="number" id="qmap-ymax-' + q.id + '" class="form-control" value="' + (q.yMax != null ? q.yMax : '') + '" placeholder="17350"></div>' +
      '</div>' +
      '<div style="display:flex;gap:8px">' +
        '<button class="btn btn-sm btn-primary qmap-save-btn" data-qid="' + q.id + '">Сохранить</button>' +
        '<button class="btn btn-sm btn-outline qmap-cal-btn" data-qid="' + q.id + '" data-qname="' + escHTML(q.name) + '">📐 Откалибровать по карте</button>' +
      '</div>' +
    '</div>';
  });

  panel.innerHTML = html;

  panel.addEventListener('click', function(e) {
    var s = e.target.closest('.qmap-save-btn');
    if (s) { _saveQuarryBoundsFromForm(s.dataset.qid); return; }
    var c = e.target.closest('.qmap-cal-btn');
    if (c) _openCalibrationTool(c.dataset.qid, c.dataset.qname);
  });
}

function _saveQuarryBoundsFromForm(qid) {
  var q = AppState.quarries && AppState.quarries.find(function(q) { return q.id === qid; });
  if (!q) return;
  var xMin = parseFloat(document.getElementById('qmap-xmin-' + qid).value);
  var xMax = parseFloat(document.getElementById('qmap-xmax-' + qid).value);
  var yMin = parseFloat(document.getElementById('qmap-ymin-' + qid).value);
  var yMax = parseFloat(document.getElementById('qmap-ymax-' + qid).value);
  if ([xMin, xMax, yMin, yMax].some(isNaN)) {
    Toast.fail('qmap', 'Введите все четыре значения координат');
    return;
  }
  if (xMin >= xMax || yMin >= yMax) {
    Toast.fail('qmap', 'X min должен быть меньше X max, Y min — меньше Y max');
    return;
  }
  Api.saveQuarryBounds(qid, { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax })
    .then(function() {
      q.xMin = xMin; q.xMax = xMax; q.yMin = yMin; q.yMax = yMax;
      Toast.show('Границы карьера «' + q.name + '» сохранены', 'success');
      renderQuarryMapsPanel();
    })
    .catch(function(err) { Toast.fail('qmap', 'Ошибка: ' + err.message); });
}

function _computeBoundsFromCalibration(p1, p2, imgW, imgH) {
  // p1, p2: {px, py, rx, ry} — pixel (natural) and real-world coordinates
  // Returns {xMin, xMax, yMin, yMax}
  if (Math.abs(p2.px - p1.px) < 1 || Math.abs(p2.py - p1.py) < 1) {
    throw new Error('Точки слишком близко. Выберите точки подальше друг от друга.');
  }
  var scaleX = (p2.rx - p1.rx) / (p2.px - p1.px);
  var xMin   = p1.rx - p1.px * scaleX;
  var xMax   = xMin + imgW * scaleX;
  // Image Y grows down, real Y grows up → inverted
  var scaleY = (p1.ry - p2.ry) / (p2.py - p1.py);
  var yMax   = p1.ry + p1.py * scaleY;
  var yMin   = yMax - imgH * scaleY;
  return { xMin: xMin, xMax: xMax, yMin: yMin, yMax: yMax };
}

function _loadSchemeUrlForQuarry(quarryName) {
  return Api.client().from('schemes')
    .select('storage_path').eq('quarry', quarryName)
    .order('uploaded_at', { ascending: false }).limit(1).maybeSingle()
    .then(function(res) {
      if (res.error || !res.data || !res.data.storage_path) return null;
      var r = Api.client().storage.from('schemes').getPublicUrl(res.data.storage_path);
      return r.data ? r.data.publicUrl : null;
    }).catch(function() { return null; });
}

function _openCalibrationTool(qid, qname) {
  var ex = document.getElementById('quarry-cal-modal');
  if (ex) ex.remove();

  var modal = document.createElement('div');
  modal.id = 'quarry-cal-modal';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.75);z-index:9500;' +
    'display:flex;align-items:center;justify-content:center;padding:16px';

  modal.innerHTML =
    '<div style="background:var(--surface);border-radius:12px;padding:20px;max-width:920px;width:100%;' +
      'max-height:94vh;overflow-y:auto;display:flex;flex-direction:column;gap:14px">' +

      '<div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">' +
        '<div style="font-size:15px;font-weight:600">📐 Калибровка карты — ' + escHTML(qname) + '</div>' +
        '<button id="cal-close" style="background:none;border:none;color:var(--txt-1);font-size:20px;cursor:pointer;padding:0 4px">✕</button>' +
      '</div>' +

      '<div id="cal-hint" style="font-size:13px;padding:8px 12px;border-radius:6px;background:rgba(26,115,232,.12);color:#7ab4f5">' +
        'Шаг 1: Нажмите на первую опорную точку на карте (точку с известными координатами X, Y)' +
      '</div>' +

      '<div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0">' +
        '<div style="font-size:12px;color:var(--txt-3)">Колёсико мыши или кнопки для зума · прокрутка для перемещения</div>' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<button id="cal-zoom-out" class="btn btn-sm btn-outline" style="padding:2px 10px;font-size:18px;line-height:1">−</button>' +
          '<span id="cal-zoom-label" style="min-width:46px;text-align:center;font-size:13px;font-weight:500">100%</span>' +
          '<button id="cal-zoom-in" class="btn btn-sm btn-outline" style="padding:2px 10px;font-size:18px;line-height:1">+</button>' +
          '<button id="cal-zoom-reset" class="btn btn-sm btn-outline" style="padding:2px 9px;font-size:12px">↺</button>' +
        '</div>' +
      '</div>' +

      '<div id="cal-wrap" style="overflow:auto;border:1px solid var(--line);border-radius:8px;' +
        'max-height:440px;cursor:crosshair;flex-shrink:0;min-height:120px;background:var(--bg)">' +
        '<div id="cal-loading" style="padding:24px;text-align:center;color:var(--txt-3)">Загрузка схемы...</div>' +
        '<div id="cal-canvas" style="position:relative;display:inline-block;line-height:0">' +
          '<img id="cal-img" style="display:none;user-select:none" draggable="false">' +
          '<div id="cal-dots" style="position:absolute;inset:0;pointer-events:none"></div>' +
        '</div>' +
      '</div>' +

      '<div style="display:flex;gap:12px;flex-wrap:wrap">' +
        '<div id="cal-p1" style="display:none;flex:1;min-width:180px;padding:10px;border-radius:8px;border:2px solid #ea4335">' +
          '<div style="font-size:12px;font-weight:600;margin-bottom:8px;color:#ea4335">● Точка 1</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
            '<div><label class="form-label">X (Восток)</label><input type="number" id="cal-x1" class="form-control" placeholder="46200"></div>' +
            '<div><label class="form-label">Y (Север)</label><input type="number" id="cal-y1" class="form-control" placeholder="16500"></div>' +
          '</div>' +
        '</div>' +
        '<div id="cal-p2" style="display:none;flex:1;min-width:180px;padding:10px;border-radius:8px;border:2px solid #7ab4f5">' +
          '<div style="font-size:12px;font-weight:600;margin-bottom:8px;color:#7ab4f5">● Точка 2</div>' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">' +
            '<div><label class="form-label">X (Восток)</label><input type="number" id="cal-x2" class="form-control" placeholder="47000"></div>' +
            '<div><label class="form-label">Y (Север)</label><input type="number" id="cal-y2" class="form-control" placeholder="17000"></div>' +
          '</div>' +
        '</div>' +
      '</div>' +

      '<div id="cal-result" style="display:none;padding:10px 14px;border-radius:8px;' +
        'background:rgba(76,175,125,.1);border:1px solid rgba(76,175,125,.3);font-size:13px"></div>' +

      '<div style="display:flex;gap:8px;justify-content:flex-end;flex-shrink:0">' +
        '<button id="cal-btn-cancel" class="btn btn-sm btn-outline">Отмена</button>' +
        '<button id="cal-btn-compute" class="btn btn-sm btn-outline" style="display:none">Вычислить границы</button>' +
        '<button id="cal-btn-save" class="btn btn-sm btn-primary" style="display:none">Сохранить</button>' +
      '</div>' +
    '</div>';

  document.body.appendChild(modal);

  var img       = document.getElementById('cal-img');
  var dots      = document.getElementById('cal-dots');
  var hint      = document.getElementById('cal-hint');
  var wrapEl    = document.getElementById('cal-wrap');
  var p1Box     = document.getElementById('cal-p1');
  var p2Box     = document.getElementById('cal-p2');
  var resultBox = document.getElementById('cal-result');
  var btnComp   = document.getElementById('cal-btn-compute');
  var btnSave   = document.getElementById('cal-btn-save');
  var calPts    = [];
  var calResult = null;
  var zoomLevel = 1.0;
  var imgBaseW  = 0;
  var ZOOM_STEPS = [0.5, 0.75, 1.0, 1.25, 1.5, 2.0, 2.5, 3.0, 4.0];

  function closeModal() { modal.remove(); }
  document.getElementById('cal-close').onclick      = closeModal;
  document.getElementById('cal-btn-cancel').onclick = closeModal;

  function renderDots() {
    dots.innerHTML = '';
    if (!img.naturalWidth || !imgBaseW) return;
    var scale = (imgBaseW * zoomLevel) / img.naturalWidth;
    calPts.forEach(function(pt, i) {
      var color = i === 0 ? '#ea4335' : '#7ab4f5';
      var dot = document.createElement('div');
      dot.style.cssText = 'position:absolute;width:14px;height:14px;border-radius:50%;' +
        'border:2px solid #fff;background:' + color + ';transform:translate(-50%,-50%);' +
        'left:' + (pt.px * scale) + 'px;top:' + (pt.py * scale) + 'px;' +
        'box-shadow:0 1px 4px rgba(0,0,0,.5)';
      dots.appendChild(dot);
    });
  }

  function applyZoom(newZoom, pivotClient) {
    if (!imgBaseW) return;
    var oldZoom = zoomLevel;
    zoomLevel = Math.max(ZOOM_STEPS[0], Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], newZoom));
    img.style.width = Math.round(imgBaseW * zoomLevel) + 'px';
    renderDots();
    document.getElementById('cal-zoom-label').textContent = Math.round(zoomLevel * 100) + '%';
    if (pivotClient) {
      var rect  = wrapEl.getBoundingClientRect();
      var pivX  = (pivotClient.x - rect.left + wrapEl.scrollLeft) * (zoomLevel / oldZoom);
      var pivY  = (pivotClient.y - rect.top  + wrapEl.scrollTop)  * (zoomLevel / oldZoom);
      wrapEl.scrollLeft = pivX - (pivotClient.x - rect.left);
      wrapEl.scrollTop  = pivY - (pivotClient.y - rect.top);
    }
  }

  function stepZoom(delta, pivotClient) {
    var idx = 0;
    var closest = Infinity;
    ZOOM_STEPS.forEach(function(s, i) {
      var d = Math.abs(s - zoomLevel);
      if (d < closest) { closest = d; idx = i; }
    });
    applyZoom(ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, idx + delta))], pivotClient);
  }

  document.getElementById('cal-zoom-in').onclick    = function() { stepZoom(+1); };
  document.getElementById('cal-zoom-out').onclick   = function() { stepZoom(-1); };
  document.getElementById('cal-zoom-reset').onclick = function() { applyZoom(1.0); };

  wrapEl.addEventListener('wheel', function(e) {
    e.preventDefault();
    stepZoom(e.deltaY < 0 ? +1 : -1, { x: e.clientX, y: e.clientY });
  }, { passive: false });

  // Load scheme image
  _loadSchemeUrlForQuarry(qname).then(function(url) {
    document.getElementById('cal-loading').style.display = 'none';
    if (!url) {
      var msg = document.createElement('div');
      msg.style.cssText = 'padding:24px;text-align:center;color:#f28b82;font-size:13px';
      msg.textContent = 'Схема для карьера «' + qname + '» не загружена. Сначала загрузите схему в разделе «Схемы».';
      wrapEl.appendChild(msg);
      hint.textContent = 'Схема не найдена — используйте ручной ввод координат.';
      return;
    }
    img.style.display = 'block';
    img.style.maxWidth = '100%';
    img.src = url;
    img.onload = function() {
      setTimeout(function() {
        imgBaseW = img.offsetWidth;
        img.style.maxWidth = 'none';
        img.style.width = imgBaseW + 'px';
        renderDots();
      }, 0);
    };
  });

  // Click on wrap to place calibration points
  wrapEl.addEventListener('click', function(e) {
    if (!img.complete || !img.naturalWidth || !imgBaseW) return;
    if (calPts.length >= 2) return;
    var rect  = img.getBoundingClientRect();
    var dispX = e.clientX - rect.left;
    var dispY = e.clientY - rect.top;
    if (dispX < 0 || dispY < 0 || dispX > img.offsetWidth || dispY > img.offsetHeight) return;
    var scaleR = img.naturalWidth / img.offsetWidth;
    var pxNat  = Math.round(dispX * scaleR);
    var pyNat  = Math.round(dispY * scaleR);

    calPts.push({ px: pxNat, py: pyNat });
    renderDots();

    if (calPts.length === 1) {
      p1Box.style.display = '';
      hint.textContent = 'Шаг 2: Введите координаты точки 1, затем нажмите на вторую точку на карте';
    } else {
      p2Box.style.display = '';
      btnComp.style.display = '';
      hint.textContent = 'Шаг 3: Введите координаты точки 2, затем нажмите «Вычислить границы»';
    }
  });

  btnComp.addEventListener('click', function() {
    if (calPts.length < 2) return;
    var x1 = parseFloat(document.getElementById('cal-x1').value);
    var y1 = parseFloat(document.getElementById('cal-y1').value);
    var x2 = parseFloat(document.getElementById('cal-x2').value);
    var y2 = parseFloat(document.getElementById('cal-y2').value);
    if ([x1,y1,x2,y2].some(isNaN)) {
      Toast.fail('cal', 'Введите координаты для обеих точек');
      return;
    }
    try {
      calResult = _computeBoundsFromCalibration(
        { px: calPts[0].px, py: calPts[0].py, rx: x1, ry: y1 },
        { px: calPts[1].px, py: calPts[1].py, rx: x2, ry: y2 },
        img.naturalWidth, img.naturalHeight
      );
    } catch(err) {
      Toast.fail('cal', err.message);
      return;
    }
    resultBox.style.display = '';
    resultBox.innerHTML =
      '<div style="font-weight:600;margin-bottom:8px">Вычисленные границы координатной сетки:</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">' +
        '<div>X min: <strong>' + Math.round(calResult.xMin) + '</strong></div>' +
        '<div>X max: <strong>' + Math.round(calResult.xMax) + '</strong></div>' +
        '<div>Y min: <strong>' + Math.round(calResult.yMin) + '</strong></div>' +
        '<div>Y max: <strong>' + Math.round(calResult.yMax) + '</strong></div>' +
      '</div>';
    btnSave.style.display = '';
    hint.textContent = '✓ Границы вычислены. Проверьте значения и нажмите «Сохранить».';
    hint.style.background = 'rgba(76,175,125,.12)';
    hint.style.color = '#4caf7d';
  });

  btnSave.addEventListener('click', function() {
    if (!calResult) return;
    btnSave.disabled = true;
    btnSave.textContent = 'Сохранение...';
    Api.saveQuarryBounds(qid, calResult)
      .then(function() {
        var q = AppState.quarries && AppState.quarries.find(function(q) { return q.id === qid; });
        if (q) { q.xMin = calResult.xMin; q.xMax = calResult.xMax; q.yMin = calResult.yMin; q.yMax = calResult.yMax; }
        Toast.show('Координатная привязка карьера «' + qname + '» сохранена', 'success');
        closeModal();
        renderQuarryMapsPanel();
      })
      .catch(function(err) {
        Toast.fail('cal', 'Ошибка: ' + err.message);
        btnSave.disabled = false;
        btnSave.textContent = 'Сохранить';
      });
  });
}
