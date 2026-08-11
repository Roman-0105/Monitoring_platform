/**
 * app.js — инициализация, роутинг, синхронизация.
 *
 * Переработан v2: логика вынесена в отдельные модули:
 *   ui-utils.js      — общие утилиты (форматирование, фильтры, GPS)
 *   ui-points.js     — список точек, формы добавления/редактирования, сотрудники
 *   ui-map.js        — карта, зум, взаимодействие
 *   ui-stats.js      — аналитика
 *   ui-settings.js   — настройки (схемы, цвета)
 *
 * Порядок подключения скриптов в index.html:
 *   storage.js → diagnostics.js → api.js → workers.js → points.js →
 *   photos.js → domens.js → map.js → schemes.js →
 *   ui-utils.js → ui-points.js → ui-map.js → ui-stats.js → ui-settings.js → app.js
 */

window.APP_CONFIG = {
  SUPABASE_URL:     'https://dusmrxvybojyrqmmqxjx.supabase.co',
  SUPABASE_KEY:     'sb_publishable_AbYc8gJjsdC04DR-kw48EQ_jnnyqy5a',
  SYNC_INTERVAL_MS: 30000, // будет перезаписан из Storage после загрузки
};

// Хранит id открытых мини-графиков на карточках точек: { pointId: true }
var _openCharts = {};

// Перезаписать интервал из настроек
function applySyncInterval() {
  var ms = Storage.getSyncInterval();
  APP_CONFIG.SYNC_INTERVAL_MS = ms;
}

var AppState = {
  currentTab:     'points',
  editingPointId: null,
  syncing:        false,
  currentUser:    null,
  activeQuarry:   (function() { try { return localStorage.getItem('activeQuarry') || ''; } catch(e) { return ''; } })(),
  quarries:       [],
};


// ── Переключатель карьеров ────────────────────────────────

function _renderQuarrySwitcher(quarries, suppressReload) {
  var el = document.getElementById('quarry-switcher');
  if (!el) return;
  if (quarries) { el._quarries = quarries; AppState.quarries = quarries; }
  var list = el._quarries || [];
  if (list.length < 2) { el.style.display = 'none'; return; }

  // Auto-select first quarry if activeQuarry is empty or not in the list
  var names = list.map(function(q) { return q.name; });
  var needsReload = false;
  if (!AppState.activeQuarry || names.indexOf(AppState.activeQuarry) < 0) {
    AppState.activeQuarry = list[0].name;
    try { localStorage.setItem('activeQuarry', AppState.activeQuarry); } catch(e) {}
    needsReload = true;
  }

  el.style.display = 'flex';
  el.innerHTML =
    '<div style="padding:2px 10px 4px;font-size:11px;font-weight:600;letter-spacing:.04em;' +
      'color:var(--txt-3,#9aa0b4);text-transform:uppercase">Карьер</div>' +
    list.map(function(q) {
      var isActive = q.name === AppState.activeQuarry;
      return '<button onclick="setActiveQuarry(\'' + escAttr(q.name.replace(/\\/g,'\\\\').replace(/'/g,"\\'")) + '\')" ' +
        'style="display:flex;align-items:center;gap:8px;width:100%;padding:7px 10px;' +
        'font-size:13px;font-weight:' + (isActive ? '600' : '400') + ';cursor:pointer;' +
        'border:none;border-radius:8px;text-align:left;transition:background .15s;' +
        'background:' + (isActive ? 'var(--accent)' : 'transparent') + ';' +
        'color:' + (isActive ? '#fff' : 'var(--txt-1)') + '">' +
        '<span style="font-size:10px;line-height:1">' + (isActive ? '◉' : '◎') + '</span>' +
        escHTML(q.name) +
        '</button>';
    }).join('');

  if (needsReload && !suppressReload) _reloadAllData();
}

window.setActiveQuarry = function(name) {
  if (name === AppState.activeQuarry) return;
  AppState.activeQuarry = name;
  try { localStorage.setItem('activeQuarry', name); } catch(e) {}
  // Reset module init flags so Supabase is re-fetched on next visit to those tabs
  if (typeof _dewInited  !== 'undefined') _dewInited  = false;
  if (typeof _dustInited !== 'undefined') _dustInited = false;
  _renderQuarrySwitcher();
  _reloadAllData();
};

function _reloadAllData() {
  if (AppState.syncing) return;
  showLoader('Переключение карьера...');
  // Clear map scheme cache so it reloads for new quarry
  window._mapSchemeImg = null;
  Promise.all([Points.load(), Schemes.load()]).then(function() {
    renderPointsList();
    initMapFilters();
    initStatsFilters();
    renderStatsPage();
    if (typeof initDitchModule === 'function') {
      initDitchModule(function() {});
    }
    if (typeof initWellsModule === 'function') {
      initWellsModule(function() {
        if (AppState.currentTab === 'wells' && typeof renderWellsPage === 'function') renderWellsPage();
      });
    }
    if (AppState.currentTab === 'map') {
      window._mapSchemeImg = null;
      if (typeof renderMap === 'function') renderMap();
    }
    if (AppState.currentTab === 'dewatering' && typeof initDewateringTab === 'function') {
      initDewateringTab();
    }
    if (AppState.currentTab === 'dust' && typeof initDustTab === 'function') {
      initDustTab();
    }
    hideLoader();
  }).catch(function(err) {
    Toast.fail('reload', 'Ошибка загрузки: ' + (err.message || ''));
    hideLoader();
  });
}

// ── Lightbox для фото ────────────────────────────────────

function initPhotoLightbox() {
  var lb = document.createElement('div');
  lb.id = 'photo-lightbox';
  lb.style.cssText = 'display:none;position:fixed;inset:0;background:rgba(0,0,0,.9);z-index:9999;' +
    'align-items:center;justify-content:center;cursor:zoom-out';
  lb.innerHTML =
    '<img id="lb-img" style="max-width:95vw;max-height:90vh;object-fit:contain;border-radius:4px">' +
    '<button id="lb-close" style="position:absolute;top:16px;right:20px;background:none;border:none;' +
    'color:#fff;font-size:32px;cursor:pointer;line-height:1">✕</button>';
  document.body.appendChild(lb);

  function openLb(src) { document.getElementById('lb-img').src = src; lb.style.display = 'flex'; document.body.style.overflow = 'hidden'; }
  function closeLb()   { lb.style.display = 'none'; document.body.style.overflow = ''; }

  // Глобальная функция для вызова из других модулей
  window.openLightbox = openLb;

  lb.addEventListener('click', function(e) { if (e.target === lb) closeLb(); });
  document.getElementById('lb-close').addEventListener('click', closeLb);
  document.addEventListener('keydown', function(e) { if (e.key === 'Escape') closeLb(); });
  // Делегированный клик — все фото галереи
  document.addEventListener('click', function(e) {
    var img = e.target;
    if (img && img.tagName === 'IMG' && (
      img.classList.contains('card-photo-thumb') ||
      img.classList.contains('mpc-photo') ||

      img.classList.contains('photo-thumb')
    )) {
      if (img.src && img.src !== window.location.href) openLb(img.src);
    }
  });
}

// ── Инициализация ─────────────────────────────────────────

window.initApp = function() {
  showLoader('Загрузка...');

  // Настройки устройства
  var devEl = document.getElementById('device-id-display');
  if (devEl) devEl.textContent = Storage.getDeviceId();
  var suEl  = document.getElementById('script-url-status');
  if (suEl)  suEl.textContent  = (APP_CONFIG.SUPABASE_URL && APP_CONFIG.SUPABASE_KEY) ? '✅ подключён' : '❌ не настроен';

  // Загружаем сохранённые настройки цветов карты
  loadMapStyleSettings();

  initTabs();

  // Сброс тултипа и карточек — только через switchTab (дублирование удалено)
  initPhotoLightbox();
  initEditModal();
  initDiagButtons();
  Photos.initPreview('f-photo-cam', 'f-photo-preview');
  Photos.initPreview('f-photo-gal', 'f-photo-preview');
  Photos.initPreview('e-photo-cam', 'e-new-photo-preview');
  Photos.initPreview('e-photo-gal', 'e-new-photo-preview');
  initSettings();
  Diagnostics.render();

  // Logout button
  var logoutBtn = document.getElementById('btn-logout');
  if (logoutBtn) {
    logoutBtn.addEventListener('click', function() {
      if (!confirm('Выйти из аккаунта?')) return;
      Auth.signOut().then(function() {
        location.reload();
      });
    });
  }
  // Show username in sidebar
  var userDisplay = document.getElementById('sidebar-user-name');
  if (userDisplay && AppState.currentUser) {
    userDisplay.textContent = AppState.currentUser.displayName || AppState.currentUser.email;
  }

  // Статус-бар: сеть
  function updateNetStatus() {
    var el = document.getElementById('sb-net');
    if (el) el.textContent = navigator.onLine ? '🟢 онлайн' : '🔴 офлайн';
  }
  updateNetStatus();
  window.addEventListener('online',  updateNetStatus);
  window.addEventListener('offline', updateNetStatus);

  // Workers (не зависят от карьера) и карьеры грузим параллельно
  Promise.all([
    Workers.load().catch(function() { return []; }),
    Api.getQuarries().catch(function() { return []; }),
  ]).then(function(results) {
    renderWorkers();
    // Устанавливаем activeQuarry ДО загрузки данных; suppressReload=true — данные
    // грузим сами ниже, чтобы не было двойного запроса
    _renderQuarrySwitcher(results[1] || [], true);
    // Загружаем данные уже с правильным activeQuarry
    return Promise.all([Points.load(), Schemes.load()]);
  }).then(function() {
    renderPointsList();
    initMapFilters();
    initStatsFilters();
    renderStatsPage();
    Diagnostics.clearError();
    Diagnostics.set('queueSize', Storage.getQueue().length);
    hideLoader();
    if (typeof initDitchModule === 'function') {
      initDitchModule(function() {
        var activeTab = document.querySelector('[data-stats-tab].active');
        if (activeTab && activeTab.dataset.statsTab === 'ditches') {
          if (typeof renderDitchStatsPanel === 'function') renderDitchStatsPanel();
        }
      });
    }
    if (typeof initWellsModule === 'function') {
      initWellsModule(function() {
        if (AppState.currentTab === 'wells' && typeof renderWellsPage === 'function') renderWellsPage();
      });
    }
  }).catch(function(err) {
    Diagnostics.setError('sync', 'Начальная загрузка: ' + err.message);
    Toast.fail('init-load', 'Ошибка загрузки данных: ' + (err.message || 'проверьте соединение'));
    renderWorkers();
    renderPointsList();
    initMapFilters();
    initStatsFilters();
    renderStatsPage();
    hideLoader();
  });

  // Автосинхронизация — интервал из настроек
  applySyncInterval();
  var _syncTimer = setInterval(syncAll, APP_CONFIG.SYNC_INTERVAL_MS);

  // Функция перезапуска таймера (вызывается из настроек при смене интервала)
  window.restartSyncTimer = function() {
    clearInterval(_syncTimer);
    applySyncInterval();
    _syncTimer = setInterval(syncAll, APP_CONFIG.SYNC_INTERVAL_MS);
  };
  window.addEventListener('online', function() { Points.flushQueue(); syncAll(); });

  // Инициализация темы
  initThemePanel();
};

document.addEventListener('DOMContentLoaded', function() {
  // Восстанавливаем тему до проверки авторизации
  try {
    var savedTheme = localStorage.getItem('app-theme') || '';
    var validThemes = ['default', 'light'];
    if (savedTheme && validThemes.indexOf(savedTheme) >= 0) applyTheme(savedTheme, null);
    _updateThemeToggleUI(savedTheme || 'default');
    if (localStorage.getItem('sidebar-collapsed')) {
      var sidebar = document.getElementById('tab-bar');
      if (sidebar) sidebar.classList.add('collapsed');
    }
  } catch(e) {}

  if (typeof Api === 'undefined' || typeof Points === 'undefined' || typeof Storage === 'undefined') {
    document.body.innerHTML =
      '<div style="padding:32px;text-align:center;font-family:sans-serif">' +
      '<h2 style="color:#ea4335">Ошибка загрузки</h2>' +
      '<p>Не удалось загрузить компоненты сайта.<br>Обнови страницу (F5).</p>' +
      '<button onclick="location.reload()" style="margin-top:16px;padding:10px 24px;' +
      'background:#1a73e8;color:#fff;border:none;border-radius:8px;font-size:15px;cursor:pointer">🔄 Обновить</button>' +
      '</div>';
    return;
  }

  // Проверяем сессию перед загрузкой приложения
  Auth.getSession().then(function(session) {
    if (!session) {
      LoginScreen.show();
      return;
    }
    return Auth.getProfile().then(function(profile) {
      AppState.currentUser = profile;
      initApp();
    });
  }).catch(function() {
    LoginScreen.show();
  });

  // Слушаем изменения auth (например, истечение токена)
  Auth.onAuthChange(function(event) {
    if (event === 'SIGNED_OUT') {
      LoginScreen.show();
    }
  });
});

// ── Переключатель темы (сайдбар) ─────────────────────────

function toggleTheme() {
  var current = document.documentElement.getAttribute('data-theme') || 'default';
  var next = current === 'light' ? 'default' : 'light';
  applyTheme(next, null);
  _updateThemeToggleUI(next);
}

function _updateThemeToggleUI(theme) {
  var icon  = document.getElementById('theme-icon');
  var label = document.getElementById('theme-label');
  var isDark = !theme || theme === 'default';
  if (icon)  icon.textContent  = isDark ? '○' : '●';
  if (label) label.textContent = isDark ? ' Светлая тема' : ' Тёмная тема';
  var btn = document.getElementById('theme-toggle-btn');
  if (btn) btn.setAttribute('data-active-theme', isDark ? 'dark' : 'light');
}

// ── Сворачивание сайдбара ─────────────────────────────────

function toggleSidebar() {
  var sidebar = document.getElementById('tab-bar');
  if (!sidebar) return;
  var collapsed = sidebar.classList.toggle('collapsed');
  try { if (collapsed) localStorage.setItem('sidebar-collapsed', '1'); else localStorage.removeItem('sidebar-collapsed'); } catch(e) {}
}

// ── Синхронизация ─────────────────────────────────────────

function syncAll() {
  if (!navigator.onLine) return;
  if (AppState.syncing) return;
  AppState.syncing = true;
  var tid = Toast.progress('sync', 'Синхронизация данных...');
  Points.flushQueue().then(function() {
    Toast.progress('sync', 'Загрузка точек и схем...', 50);
    return Promise.all([Points.load(), Workers.load(), Schemes.load()]);
  }).then(function() {
    renderPointsList();
    renderWorkers();
    initMapFilters();
    initStatsFilters();
    renderStatsPage();
    Diagnostics.clearError();
    Toast.done('sync', 'Данные синхронизированы');
    if (typeof initWellsModule === 'function') {
      initWellsModule(function() {
        if (AppState.currentTab === 'wells' && typeof renderWellsPage === 'function') renderWellsPage();
      });
    }
  }).catch(function(err) {
    Diagnostics.setError('sync', err.message);
    Toast.fail('sync', 'Ошибка синхронизации: ' + err.message);
  }).then(function() {
    AppState.syncing = false;
  });
}

// ── Вкладки ───────────────────────────────────────────────

function initTabs() {
  document.querySelectorAll('[data-tab]').forEach(function(btn) {
    btn.addEventListener('click', function() { switchTab(this.dataset.tab); });
  });
}

function switchTab(name) {
  AppState.currentTab = name;
  document.querySelectorAll('.tab-btn').forEach(function(b) {
    b.classList.toggle('active', b.dataset.tab === name);
  });
  document.querySelectorAll('.page').forEach(function(p) {
    p.classList.toggle('active', p.id === 'page-' + name);
  });
  // Скрываем тултип и карточки карты при любом переключении вкладки
  if (typeof hideMapTooltip === 'function') hideMapTooltip();
  // Инициализация модуля отчёта (только первый раз)
  if (name === 'report' && typeof initReportTab === 'function' && !window._reportInited) {
    window._reportInited = true;
    initReportTab();
  }
  if (name !== 'wells' && typeof _wellsMap !== 'undefined') {
    _wellsMap.animating = false;
  }
  if (name === 'wells' && typeof initWellsTab === 'function') {
    initWellsTab();
  }
  if (name === 'dewatering' && typeof initDewateringTab === 'function') {
    initDewateringTab();
  }
  if (name === 'dust' && typeof initDustTab === 'function') {
    initDustTab();
  }
  if (name === 'sump-forecast' && typeof initSumpForecastTab === 'function') {
    initSumpForecastTab();
  }
  var tooltipEl = document.getElementById('map-tooltip');
  if (tooltipEl) tooltipEl.style.display = 'none';
  document.querySelectorAll('.map-point-card').forEach(function(el){ el.remove(); });
  // Скрываем карточку канавы (класс ditch-map-card)
  document.querySelectorAll('.ditch-map-card').forEach(function(el){ el.remove(); });

  if (name !== 'map' && typeof MapModule !== 'undefined' && MapModule.stopPulse) MapModule.stopPulse();
  if (name === 'diag')     Diagnostics.render();
  if (name === 'map')      { _mapSchemeImg = null; initMapFilters(); renderMap(); initMapLegend(); updateMapLegendPoints(); }
  if (name === 'settings') { refreshSchemesData(); renderSettingsColors(); switchSettingsTab('main'); if (typeof renderUsersPanel === 'function' && AppState.currentUser && AppState.currentUser.role === 'admin') renderUsersPanel(); }
  if (name === 'workers')  renderWorkerManageList();
  if (name === 'stats')    { initStatsSubTabs(); renderStatsPage(); }
}

// ── Диагностика ───────────────────────────────────────────

function initDiagButtons() {
  var s = document.getElementById('btn-sync-now');
  if (s) s.addEventListener('click', syncAll);
  var f = document.getElementById('btn-flush-queue');
  if (f) f.addEventListener('click', function() { Points.flushQueue(); });
  var c = document.getElementById('btn-clear-cache');
  if (c) c.addEventListener('click', function() {
    if (confirm('Очистить локальный кэш?')) {
      Toast.progress('cache', 'Очистка кэша...');
      setTimeout(function() { Storage.clearAll(); location.reload(); }, 400);
    }
  });
}

// ── Рейл аналитики ──────────────────────────────────────────

// Вкладки с фильтр-баром (Сводка, Домены, Скважины)
var _STATS_FILTER_TABS = { summary: true, domains: true, wells: true };

function initStatsSubTabs() {
  // Инжектируем CSS для страницы аналитики (один раз)
  if (!document.getElementById('stats-rail-css')) {
    var style = document.createElement('style');
    style.id = 'stats-rail-css';
    style.textContent = [
      '#page-stats{padding:0!important;overflow:hidden!important}',
      '#page-stats.active{display:flex!important;flex-direction:column!important}',
      '#page-stats #anl-filter-bar{flex-shrink:0;border-radius:0;border-left:none;border-right:none;border-top:none;margin-bottom:0}',
      '.stats-rail-panel{display:none}',
      '.stats-rail-panel.active{display:block}',
    ].join('');
    document.head.appendChild(style);
  }

  // Привязываем клики по рейлу
  var tabs = document.querySelectorAll('#stats-rail [data-stats-tab]');
  if (!tabs.length) return;
  tabs.forEach(function(btn) {
    if (btn._statsBound) return;
    btn._statsBound = true;
    btn.addEventListener('click', function() {
      switchStatsTab(this.dataset.statsTab);
    });
  });
}

function switchStatsTab(name) {
  // Обновляем активный элемент рейла
  document.querySelectorAll('#stats-rail [data-stats-tab]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.statsTab === name);
  });

  // Переключаем панели
  document.querySelectorAll('.stats-rail-panel').forEach(function(panel) {
    panel.classList.remove('active');
  });
  var activePanel = document.getElementById('stats-panel-' + name);
  if (activePanel) activePanel.classList.add('active');

  // Показываем/скрываем фильтр-бар
  var filterBar = document.getElementById('anl-filter-bar');
  if (filterBar) filterBar.style.display = _STATS_FILTER_TABS[name] ? '' : 'none';

  // Ленивая инициализация вкладок
  if (name === 'history' && typeof initHistoryTab === 'function') {
    initHistoryTab();
  }
  if (name === 'ditches' && typeof initDitchStatsTab === 'function') {
    initDitchStatsTab();
  }
  // При переходе на Домены или Скважины — перерисовываем их содержимое
  if (name === 'domains' && typeof _anlRenderDomains === 'function') {
    _anlRenderDomains(); _anlRenderMatrix(); _anlRenderWalls(); _anlRenderHorizons();
  }
  if (name === 'wells' && typeof _anlRenderWells === 'function') {
    _anlRenderWells();
  }
}

// ── Темы сайта ────────────────────────────────────────────
function applyTheme(theme, btn) {
  var html = document.documentElement;
  if (theme === 'default') {
    html.removeAttribute('data-theme');
  } else {
    html.setAttribute('data-theme', theme);
  }
  try { localStorage.setItem('app-theme', theme); } catch(e) {}

  // Подсвечиваем активную кнопку
  document.querySelectorAll('.theme-btn').forEach(function(b) {
    b.classList.toggle('active', b === btn || b.dataset.theme === theme);
  });
}

function initThemePanel() {
  // Восстанавливаем сохранённую тему
  var saved = '';
  try { saved = localStorage.getItem('app-theme') || ''; } catch(e) {}
  // Если сохранённая тема из старого набора — сбросить на default
  var validThemes = ['default', 'light'];
  if (saved && validThemes.indexOf(saved) < 0) saved = 'default';
  if (saved) applyTheme(saved, null);
  _updateThemeToggleUI(saved || 'default');

  // Восстанавливаем состояние сайдбара
  try {
    if (localStorage.getItem('sidebar-collapsed')) {
      var sidebar = document.getElementById('tab-bar');
      if (sidebar) sidebar.classList.add('collapsed');
    }
  } catch(e) {}
}

