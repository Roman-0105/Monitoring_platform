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
};


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

  // Глобальный сброс тултипа при смене вкладки
  document.querySelectorAll('.tab-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      var tooltipEl = document.getElementById('map-tooltip');
      if (tooltipEl) tooltipEl.style.display = 'none';
      document.querySelectorAll('.map-point-card').forEach(function(el){ el.remove(); });
  // Скрываем карточку канавы (класс ditch-map-card)
  document.querySelectorAll('.ditch-map-card').forEach(function(el){ el.remove(); });
    });
  });
  initPhotoLightbox();
  initAddForm();
  initEditModal();
  initDiagButtons();
  Photos.initPhotoInput('f-photo', 'f-photo-preview');
  // Кнопка "Загрузить фото" — открывает выбор источника
  var fPhotoBtn = document.getElementById('f-photo-btn');
  if (fPhotoBtn) {
    fPhotoBtn.addEventListener('click', function() {
      showPhotoSourceModal('f-photo', 'f-photo-preview', 'f-photo-progress', false);
    });
  }
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

  // Загрузка данных
  Promise.all([Workers.load(), Points.load(), Schemes.load()]).then(function() {
    renderWorkers();
    renderPointsList();
    initMapFilters();
    initStatsFilters();
    renderStatsPage();
    Diagnostics.clearError();
    Diagnostics.set('queueSize', Storage.getQueue().length);
    hideLoader();
    // Инициализируем модуль канав
    if (typeof initDitchModule === 'function') {
      initDitchModule(function() {
        // После загрузки — обновляем панель канав если она открыта
        var activeTab = document.querySelector('[data-stats-tab].active');
        if (activeTab && activeTab.dataset.statsTab === 'ditches') {
          if (typeof renderDitchStatsPanel === 'function') renderDitchStatsPanel();
        }
      });
    }
  }).catch(function(err) {
    Diagnostics.setError('sync', 'Начальная загрузка: ' + err.message);
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
  if (icon)  icon.textContent  = isDark ? '☀' : '🌑';
  if (label) label.textContent = isDark ? ' Светлая тема' : ' Тёмная тема';
}

// ── Сворачивание сайдбара ─────────────────────────────────

function toggleSidebar() {
  var sidebar = document.getElementById('tab-bar');
  if (!sidebar) return;
  var collapsed = sidebar.classList.toggle('collapsed');
  try { localStorage.setItem('sidebar-collapsed', collapsed ? '1' : ''); } catch(e) {}
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
  var tooltipEl = document.getElementById('map-tooltip');
  if (tooltipEl) tooltipEl.style.display = 'none';
  document.querySelectorAll('.map-point-card').forEach(function(el){ el.remove(); });
  // Скрываем карточку канавы (класс ditch-map-card)
  document.querySelectorAll('.ditch-map-card').forEach(function(el){ el.remove(); });

  if (name === 'add')      resetAddForm();
  if (name === 'diag')     Diagnostics.render();
  if (name === 'map')      { _mapSchemeImg = null; initMapFilters(); renderMap(); initMapLegend(); updateMapLegendPoints(); }
  if (name === 'settings') { refreshSchemesData(); renderSettingsColors(); switchSettingsTab('main'); if (typeof renderUsersPanel === 'function' && AppState.currentUser && AppState.currentUser.role === 'admin') renderUsersPanel(); }
  if (name === 'workers')  renderWorkerManageList();
  if (name === 'stats')    { renderStatsPage(); initStatsSubTabs(); }
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

// ── Подвкладки аналитики ──────────────────────────────────

function initStatsSubTabs() {
  var tabs = document.querySelectorAll('[data-stats-tab]');
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
  document.querySelectorAll('[data-stats-tab]').forEach(function(btn) {
    btn.classList.toggle('active', btn.dataset.statsTab === name);
  });
  // Управляем видимостью через CSS-класс active (не style.display)
  document.querySelectorAll('.stats-subpanel').forEach(function(panel) {
    panel.classList.remove('active');
  });
  var activePanel = document.getElementById('stats-panel-' + name);
  if (activePanel) activePanel.classList.add('active');

  if (name === 'history' && typeof initHistoryTab === 'function') {
    initHistoryTab();
  }
  if (name === 'ditches' && typeof initDitchStatsTab === 'function') {
    initDitchStatsTab();
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

