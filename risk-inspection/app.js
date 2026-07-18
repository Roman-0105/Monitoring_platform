/* Каркас панели: шапка, выпадающие меню, MDI-вкладки */

var TAB_DEFS = {
  journal: { title: 'Журнал Обращений', init: initJournalPanel },
  plotNames: { title: 'Названия участков', init: initPlotNamesPanel },
  fixedRisks: { title: 'Зафиксированные риски', init: initFixedRisksPanel },
  indicators: { title: 'Индикаторы опасностей', init: initIndicatorsPanel },
  levels: { title: 'Уровни опасности', init: initLevelsPanel },
  notifications: { title: 'Уведомления', init: initNotificationsPanel },
  contacts: { title: 'Контакты', init: initContactsPanel },
};

var AppState = { openTabs: [], activeTab: null };

function openTab(key) {
  closeAllMenus();
  var def = TAB_DEFS[key];
  if (!def) return;

  if (AppState.openTabs.indexOf(key) === -1) {
    AppState.openTabs.push(key);
    var tabBtn = document.createElement('div');
    tabBtn.className = 'ri-mtab';
    tabBtn.dataset.key = key;
    tabBtn.innerHTML = '<span>' + escHTML(def.title) + '</span><button type="button" class="ri-mtab-close" title="Закрыть">✕</button>';
    tabBtn.addEventListener('click', function(e) { if (!e.target.classList.contains('ri-mtab-close')) activateTab(key); });
    tabBtn.querySelector('.ri-mtab-close').addEventListener('click', function(e) { e.stopPropagation(); closeTab(key); });
    document.getElementById('ri-tabstrip').appendChild(tabBtn);

    var panel = document.createElement('div');
    panel.className = 'ri-panel';
    panel.id = 'ri-panel-' + key;
    document.getElementById('ri-content').appendChild(panel);
    def.init(panel);
  }
  activateTab(key);
}

function activateTab(key) {
  AppState.activeTab = key;
  document.querySelectorAll('.ri-mtab').forEach(function(t) { t.classList.toggle('active', t.dataset.key === key); });
  document.querySelectorAll('.ri-panel').forEach(function(p) { p.classList.toggle('active', p.id === 'ri-panel-' + key); });
}

function closeTab(key) {
  AppState.openTabs = AppState.openTabs.filter(function(k) { return k !== key; });
  var tabBtn = document.querySelector('.ri-mtab[data-key="' + key + '"]');
  if (tabBtn) tabBtn.remove();
  var panel = document.getElementById('ri-panel-' + key);
  if (panel) panel.remove();
  if (AppState.activeTab === key) {
    var last = AppState.openTabs[AppState.openTabs.length - 1];
    if (last) activateTab(last); else AppState.activeTab = null;
  }
}

/* ---------------- Выпадающие меню шапки ---------------- */

function closeAllMenus() {
  document.querySelectorAll('.ri-menu-item.ri-menu-open').forEach(function(el) { el.classList.remove('ri-menu-open'); });
}

function initHeaderMenus() {
  document.querySelectorAll('.ri-menu-item[data-dropdown]').forEach(function(item) {
    var btn = item.querySelector('.ri-menu-btn');
    btn.addEventListener('click', function(e) {
      e.stopPropagation();
      var wasOpen = item.classList.contains('ri-menu-open');
      closeAllMenus();
      if (!wasOpen) item.classList.add('ri-menu-open');
    });
  });
  document.addEventListener('click', closeAllMenus);
}

function initTheme() {
  var saved = localStorage.getItem('ri_theme') || 'dark';
  var btn = document.getElementById('ri-theme-toggle');
  function applyTheme(theme) {
    document.documentElement.setAttribute('data-ri-theme', theme);
    btn.textContent = theme === 'light' ? '🌙' : '☀️';
    btn.title = theme === 'light' ? 'Переключить на тёмную тему' : 'Переключить на светлую тему';
  }
  applyTheme(saved);
  btn.addEventListener('click', function() {
    var cur = document.documentElement.getAttribute('data-ri-theme') === 'light' ? 'dark' : 'light';
    applyTheme(cur);
    localStorage.setItem('ri_theme', cur);
  });
}

document.addEventListener('DOMContentLoaded', function() {
  initTheme();
  initHeaderMenus();
  document.querySelectorAll('[data-open-tab]').forEach(function(el) {
    el.addEventListener('click', function() { openTab(el.dataset.openTab); });
  });
  document.getElementById('ri-logout').addEventListener('click', function() {
    Toast.show('Выход из тестовой модели — авторизация подключается вместе с боевым API', 'info');
  });
  openTab('journal');
});
