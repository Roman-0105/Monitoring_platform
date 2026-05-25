// ── Карьерный водоотлив ──────────────────────────────────────

var DewateringState = {
  sumps:        [],
  pumps:        [],
  destinations: [],
  sessions:     [],

  _id: function(p) { return p + Date.now() + '_' + Math.random().toString(36).slice(2, 6); },

  load: function() {
    try {
      var raw = localStorage.getItem('dew_v1');
      var d = raw ? JSON.parse(raw) : {};
      this.sumps        = Array.isArray(d.sumps)        ? d.sumps        : [];
      this.pumps        = Array.isArray(d.pumps)        ? d.pumps        : [];
      this.destinations = Array.isArray(d.destinations) ? d.destinations : _dewDefaultDest();
      this.sessions     = Array.isArray(d.sessions)     ? d.sessions     : [];
    } catch(e) {
      this.sumps = []; this.pumps = []; this.destinations = _dewDefaultDest(); this.sessions = [];
    }
  },

  save: function() {
    localStorage.setItem('dew_v1', JSON.stringify({
      sumps: this.sumps, pumps: this.pumps,
      destinations: this.destinations, sessions: this.sessions
    }));
  },

  sumpById:    function(id) { return this.sumps.find(function(x) { return x.id === id; }); },
  pumpById:    function(id) { return this.pumps.find(function(x) { return x.id === id; }); },
  destById:    function(id) { return this.destinations.find(function(x) { return x.id === id; }); },
  pumpsOfSump: function(sumpId) { return this.pumps.filter(function(p) { return p.sumpId === sumpId; }); },

  totalHours: function(pumpId) {
    return this.sessions.filter(function(s) { return s.pumpId === pumpId; })
                        .reduce(function(a, s) { return a + (parseFloat(s.hoursWorked) || 0); }, 0);
  },
  totalVol: function(pumpId) {
    return this.sessions.filter(function(s) { return s.pumpId === pumpId; })
                        .reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
  },

  addSump: function(d) { d.id = this._id('smp'); this.sumps.push(d); this.save(); return d; },
  updateSump: function(id, d) {
    var i = this.sumps.findIndex(function(s) { return s.id === id; });
    if (i >= 0) { this.sumps[i] = Object.assign({}, this.sumps[i], d); this.save(); }
  },
  deleteSump: function(id) {
    var pIds = this.pumps.filter(function(p) { return p.sumpId === id; }).map(function(p) { return p.id; });
    this.sumps    = this.sumps.filter(function(s) { return s.id !== id; });
    this.pumps    = this.pumps.filter(function(p) { return p.sumpId !== id; });
    this.sessions = this.sessions.filter(function(s) { return pIds.indexOf(s.pumpId) < 0; });
    this.save();
  },

  addPump: function(d) { d.id = this._id('pmp'); this.pumps.push(d); this.save(); return d; },
  updatePump: function(id, d) {
    var i = this.pumps.findIndex(function(p) { return p.id === id; });
    if (i >= 0) { this.pumps[i] = Object.assign({}, this.pumps[i], d); this.save(); }
  },
  deletePump: function(id) {
    this.pumps    = this.pumps.filter(function(p) { return p.id !== id; });
    this.sessions = this.sessions.filter(function(s) { return s.pumpId !== id; });
    this.save();
  },

  addDest: function(d) { d.id = this._id('dst'); this.destinations.push(d); this.save(); return d; },
  deleteDest: function(id) {
    this.destinations = this.destinations.filter(function(d) { return d.id !== id; });
    this.save();
  },

  addSession: function(d) { d.id = this._id('ses'); this.sessions.push(d); this.save(); return d; },
  updateSession: function(id, d) {
    var i = this.sessions.findIndex(function(s) { return s.id === id; });
    if (i >= 0) { this.sessions[i] = Object.assign({}, this.sessions[i], d); this.save(); }
  },
  deleteSession: function(id) {
    this.sessions = this.sessions.filter(function(s) { return s.id !== id; });
    this.save();
  },
};

function _dewDefaultDest() {
  return [
    { id: 'dst0', name: 'Отстойник №1',     type: 'settler'  },
    { id: 'dst1', name: 'Пруд-накопитель',   type: 'settler'  },
    { id: 'dst2', name: 'Технические нужды', type: 'reuse'    },
    { id: 'dst3', name: 'Пылеподавление',    type: 'reuse'    },
    { id: 'dst4', name: 'Перекачка на гор.', type: 'internal' },
  ];
}

var DEW_PUMP_STATUS = {
  working: { label: 'Работает', cls: 'pg' },
  standby: { label: 'Резерв',   cls: 'pb' },
  repair:  { label: 'Ремонт',   cls: 'py' },
  off:     { label: 'Отключён', cls: 'p_' },
};

var DEW_DEST_TYPE = {
  settler:  { label: 'Отстойник / пруд',    icon: '💧' },
  internal: { label: 'Внутри карьера',      icon: '↕'  },
  reuse:    { label: 'Повторное использ.',  icon: '♻'  },
  outside:  { label: 'За карьер',           icon: '→'  },
};

var _dewInited = false;
var _dewSubTab = 'overview';
var _dewJournalFilter = { sumpId: '', month: '' };

function initDewateringTab() {
  DewateringState.load();
  if (!_dewInited) {
    _dewInited = true;
    document.querySelectorAll('[data-dew-tab]').forEach(function(btn) {
      btn.addEventListener('click', function() { _dewSwitch(this.dataset.dewTab); });
    });
  }
  _dewSwitch(_dewSubTab);
}

function _dewSwitch(tab) {
  _dewSubTab = tab;
  document.querySelectorAll('[data-dew-tab]').forEach(function(b) {
    b.classList.toggle('active', b.dataset.dewTab === tab);
  });
  document.querySelectorAll('.dew-panel').forEach(function(p) {
    p.classList.toggle('active', p.id === 'dew-panel-' + tab);
  });
  if (tab === 'overview')  _dewRenderOverview();
  if (tab === 'sumps')     _dewRenderSumps();
  if (tab === 'journal')   _dewRenderJournal();
  if (tab === 'analytics') _dewRenderAnalytics();
}

// ── Обзор ────────────────────────────────────────────────────

function _dewRenderOverview() {
  var el = document.getElementById('dew-panel-overview');
  if (!el) return;

  var today      = new Date().toISOString().slice(0, 10);
  var monthStart = today.slice(0, 7) + '-01';

  var allPumps = DewateringState.pumps;
  var working  = allPumps.filter(function(p) { return p.status === 'working'; }).length;
  var standby  = allPumps.filter(function(p) { return p.status === 'standby'; }).length;
  var repair   = allPumps.filter(function(p) { return p.status === 'repair';  }).length;

  var todaySess  = DewateringState.sessions.filter(function(s) { return s.date === today; });
  var monthSess  = DewateringState.sessions.filter(function(s) { return s.date >= monthStart; });
  var volToday   = todaySess.reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
  var volMonth   = monthSess.reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
  var hrsMonth   = monthSess.reduce(function(a, s) { return a + (parseFloat(s.hoursWorked)  || 0); }, 0);

  var nowRu = new Date().toLocaleString('ru', { month: 'long' });

  var kpiHtml =
    '<div class="anl-kpi-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:16px">' +
    _dewKpi('Зумпфов в карьере',   DewateringState.sumps.length, allPumps.length + ' насосов', 'var(--gold)') +
    _dewKpi('Работают сейчас',     working, standby + ' рез. · ' + repair + ' рем.', 'var(--ok)') +
    _dewKpi('Откачано за сутки',   volToday.toFixed(0) + ' <small>м³</small>', todaySess.length + ' смен', 'var(--blue)') +
    _dewKpi('Откачано за месяц',   volMonth.toFixed(0) + ' <small>м³</small>', nowRu, 'var(--warn)') +
    _dewKpi('Наработка за месяц',  hrsMonth.toFixed(1) + ' <small>ч</small>', allPumps.length + ' насосов', 'var(--gold)') +
    _dewKpi('Всего записей',       DewateringState.sessions.length, 'в журнале', 'var(--txt-2)') +
    '</div>';

  var sumpsHtml;
  if (!DewateringState.sumps.length) {
    sumpsHtml = '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:13px">' +
      'Зумпфы не добавлены — перейдите на вкладку <b>Зумпфы</b></div>';
  } else {
    sumpsHtml =
      '<div style="font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.06em;color:var(--txt-3);margin-bottom:8px">Состояние зумпфов</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px">' +
      DewateringState.sumps.map(function(sump) {
        var pumps = DewateringState.pumpsOfSump(sump.id);
        var wk = pumps.filter(function(p) { return p.status === 'working'; }).length;
        var st = pumps.filter(function(p) { return p.status === 'standby'; }).length;
        var rp = pumps.filter(function(p) { return p.status === 'repair';  }).length;
        var sVol = DewateringState.sessions.filter(function(s) {
          return s.date >= monthStart && pumps.some(function(p) { return p.id === s.pumpId; });
        }).reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
        var lvl = sump.currentLevel != null && sump.currentLevel !== '' ? parseFloat(sump.currentLevel) : null;
        var cap = sump.capacity ? parseFloat(sump.capacity) : null;
        var lvlPct = (lvl != null && cap) ? Math.min(100, Math.round(lvl / cap * 100)) : null;
        var lvlClr = lvlPct != null ? (lvlPct > 80 ? 'var(--bad)' : lvlPct > 50 ? 'var(--warn)' : 'var(--ok)') : 'var(--ok)';
        return '<div class="card" style="padding:14px">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
            '<div style="font-weight:600;color:var(--txt-1);font-size:13px">' + escHTML(sump.name) + '</div>' +
            (sump.horizon != null ? '<div style="font-size:10px;color:var(--txt-3)">гор. ' + sump.horizon + ' м</div>' : '') +
          '</div>' +
          (lvl != null ?
            '<div style="margin-bottom:8px">' +
              '<div style="display:flex;justify-content:space-between;font-size:10px;color:var(--txt-3);margin-bottom:3px">' +
                '<span>Уровень воды</span><span style="color:var(--txt-2);font-weight:600">' + lvl.toFixed(1) + ' м' + (cap ? ' / ' + cap + ' м' : '') + '</span>' +
              '</div>' +
              '<div style="background:var(--bg-1);border-radius:3px;height:6px;overflow:hidden">' +
                '<div style="height:100%;width:' + (lvlPct || 0) + '%;background:' + lvlClr + ';border-radius:3px;transition:.3s"></div>' +
              '</div>' +
            '</div>' : '') +
          '<div style="display:flex;gap:12px;font-size:11px;color:var(--txt-3);margin-bottom:8px">' +
            '<span>Насосов: <b style="color:var(--txt-1)">' + pumps.length + '</b></span>' +
            '<span style="color:var(--ok)">▶ ' + wk + ' раб.</span>' +
            '<span style="color:var(--gold)">◼ ' + st + ' рез.</span>' +
            (rp ? '<span style="color:var(--warn)">⚠ ' + rp + ' рем.</span>' : '') +
          '</div>' +
          '<div style="font-size:11px;color:var(--txt-3)">За месяц: <span style="color:var(--txt-1);font-weight:600">' + sVol.toFixed(0) + ' м³</span></div>' +
        '</div>';
      }).join('') +
      '</div>';
  }

  el.innerHTML = kpiHtml + sumpsHtml;
}

function _dewKpi(label, val, sub, clr) {
  return '<div class="anl-kpi">' +
    '<div class="anl-kpi-lbl">' + label + '</div>' +
    '<div class="anl-kpi-val" style="color:' + clr + '">' + val + '</div>' +
    (sub ? '<div class="anl-kpi-sub">' + sub + '</div>' : '') +
  '</div>';
}

// ── Зумпфы и насосы ─────────────────────────────────────────

function _dewRenderSumps() {
  var el = document.getElementById('dew-panel-sumps');
  if (!el) return;

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;align-items:start">' +
      '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">Зумпфы</div>' +
          '<button class="btn btn-sm" id="dew-btn-add-sump" style="background:var(--gold);color:#000;font-size:11px">+ Зумпф</button>' +
        '</div>' +
        '<div id="dew-sumps-list"></div>' +
        '<div id="dew-sump-form"></div>' +
      '</div>' +
      '<div>' +
        '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:10px">' +
          '<div style="font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:.05em;color:var(--txt-3)">Насосы</div>' +
          '<button class="btn btn-sm btn-outline" id="dew-btn-add-pump" style="font-size:11px">+ Насос</button>' +
        '</div>' +
        '<div id="dew-pumps-list"></div>' +
        '<div id="dew-pump-form"></div>' +
        '<div style="margin-top:14px;padding-top:12px;border-top:1px solid var(--line)">' +
          '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">' +
            '<div style="font-size:11px;font-weight:600;color:var(--txt-3);text-transform:uppercase;letter-spacing:.05em">Направления перекачки</div>' +
            '<button class="btn btn-sm btn-outline" id="dew-btn-add-dest" style="font-size:11px">+ Добавить</button>' +
          '</div>' +
          '<div id="dew-dest-list"></div>' +
          '<div id="dew-dest-form"></div>' +
        '</div>' +
      '</div>' +
    '</div>';

  _dewRenderSumpsList();
  _dewRenderPumpsList();
  _dewRenderDestList();

  document.getElementById('dew-btn-add-sump').addEventListener('click', function() { _dewOpenSumpForm(null); });
  document.getElementById('dew-btn-add-pump').addEventListener('click', function() {
    if (!DewateringState.sumps.length) { Toast.show('Сначала добавьте зумпф', 'warning'); return; }
    _dewOpenPumpForm(null);
  });
  document.getElementById('dew-btn-add-dest').addEventListener('click', _dewOpenDestForm);
}

function _dewRenderSumpsList() {
  var el = document.getElementById('dew-sumps-list');
  if (!el) return;
  if (!DewateringState.sumps.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:12px;padding:8px 0">Нет зумпфов</p>';
    return;
  }
  el.innerHTML = DewateringState.sumps.map(function(s) {
    var pumps = DewateringState.pumpsOfSump(s.id);
    return '<div class="card" style="padding:12px 14px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<div style="font-weight:600;color:var(--txt-1);font-size:13px;flex:1">' + escHTML(s.name) + '</div>' +
        (s.horizon != null ? '<span style="font-size:10px;color:var(--txt-3)">гор. ' + s.horizon + ' м</span>' : '') +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 7px" onclick="_dewOpenSumpForm(\'' + s.id + '\')">✎</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:rgba(248,113,113,.12);color:var(--bad);border:1px solid rgba(248,113,113,.25)" onclick="_dewDeleteSump(\'' + s.id + '\')">✕</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--txt-3);display:flex;gap:12px;flex-wrap:wrap">' +
        (s.capacity ? '<span>Объём: <b style="color:var(--txt-2)">' + s.capacity + ' м³</b></span>' : '') +
        (s.currentLevel != null && s.currentLevel !== '' ? '<span>Уровень: <b style="color:var(--txt-2)">' + parseFloat(s.currentLevel).toFixed(1) + ' м</b></span>' : '') +
        '<span>Насосов: <b style="color:var(--txt-2)">' + pumps.length + '</b></span>' +
      '</div>' +
      (s.notes ? '<div style="font-size:10px;color:var(--txt-3);margin-top:4px">' + escHTML(s.notes) + '</div>' : '') +
    '</div>';
  }).join('');
}

function _dewOpenSumpForm(id) {
  var s = id ? DewateringState.sumpById(id) : null;
  var formEl = document.getElementById('dew-sump-form');
  if (!formEl) return;
  formEl.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid var(--gold-2)">' +
    '<div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px">' + (id ? 'Редактировать зумпф' : 'Новый зумпф') + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    _dewFld('Название', 'text', 'dew-sf-name',  s ? s.name : '', 'Зумпф №1') +
    _dewFld('Горизонт (м)', 'number', 'dew-sf-horizon', s && s.horizon != null ? s.horizon : '', '-120') +
    _dewFld('Глубина зумпфа (м)', 'number', 'dew-sf-capacity', s ? s.capacity || '' : '', '5') +
    _dewFld('Тек. уровень воды (м)', 'number', 'dew-sf-level', s && s.currentLevel != null ? s.currentLevel : '', '1.5') +
    '</div>' +
    _dewFld('Примечание', 'text', 'dew-sf-notes', s ? s.notes || '' : '', '') +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-sf-save">Сохранить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-sf-cancel">Отмена</button>' +
    '</div></div>';

  document.getElementById('dew-sf-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-sf-save').onclick = function() {
    var name = document.getElementById('dew-sf-name').value.trim();
    if (!name) { Toast.show('Введите название зумпфа', 'warning'); return; }
    var data = {
      name: name,
      horizon:      document.getElementById('dew-sf-horizon').value.trim()  || null,
      capacity:     document.getElementById('dew-sf-capacity').value.trim() || null,
      currentLevel: document.getElementById('dew-sf-level').value.trim()    || null,
      notes:        document.getElementById('dew-sf-notes').value.trim()    || '',
    };
    if (id) DewateringState.updateSump(id, data);
    else    DewateringState.addSump(data);
    formEl.innerHTML = '';
    _dewRenderSumpsList();
    Toast.show(id ? 'Зумпф обновлён' : 'Зумпф добавлен', 'success');
  };
}

function _dewDeleteSump(id) {
  var s = DewateringState.sumpById(id);
  if (!s || !confirm('Удалить зумпф "' + s.name + '" и все его насосы и журнал?')) return;
  DewateringState.deleteSump(id);
  _dewRenderSumpsList();
  _dewRenderPumpsList();
  Toast.show('Зумпф удалён', 'info');
}

function _dewRenderPumpsList() {
  var el = document.getElementById('dew-pumps-list');
  if (!el) return;
  if (!DewateringState.pumps.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:12px;padding:8px 0">Нет насосов</p>';
    return;
  }
  el.innerHTML = DewateringState.pumps.map(function(p) {
    var sump = DewateringState.sumpById(p.sumpId);
    var st   = DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off;
    var hrs  = DewateringState.totalHours(p.id).toFixed(1);
    var vol  = DewateringState.totalVol(p.id).toFixed(0);
    return '<div class="card" style="padding:12px 14px;margin-bottom:8px">' +
      '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">' +
        '<div style="flex:1;font-weight:600;color:var(--txt-1);font-size:13px">' + escHTML(p.name) + '</div>' +
        '<span class="anl-pill anl-pill-' + st.cls + '">' + st.label + '</span>' +
        '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 7px" onclick="_dewOpenPumpForm(\'' + p.id + '\')">✎</button>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 7px;background:rgba(248,113,113,.12);color:var(--bad);border:1px solid rgba(248,113,113,.25)" onclick="_dewDeletePump(\'' + p.id + '\')">✕</button>' +
      '</div>' +
      '<div style="font-size:11px;color:var(--txt-3);display:flex;gap:10px;flex-wrap:wrap">' +
        (p.model ? '<span style="color:var(--txt-2)">' + escHTML(p.model) + '</span>' : '') +
        '<span>Q: <b style="color:var(--txt-2)">' + (p.capacity || '—') + ' м³/ч</b></span>' +
        (sump ? '<span>↳ ' + escHTML(sump.name) + (sump.horizon ? ' (' + sump.horizon + ' м)' : '') + '</span>' : '') +
        '<span>⏱ ' + hrs + ' ч</span>' +
        '<span style="color:var(--ok)">↑ ' + vol + ' м³</span>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _dewOpenPumpForm(id) {
  var p = id ? DewateringState.pumpById(id) : null;
  var formEl = document.getElementById('dew-pump-form');
  if (!formEl) return;

  var statusOpts = Object.keys(DEW_PUMP_STATUS).map(function(k) {
    return '<option value="' + k + '"' + (p && p.status === k ? ' selected' : '') + '>' + DEW_PUMP_STATUS[k].label + '</option>';
  }).join('');
  var sumpOpts = DewateringState.sumps.map(function(s) {
    return '<option value="' + s.id + '"' + (p && p.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + (s.horizon ? ' (гор. ' + s.horizon + ' м)' : '') + '</option>';
  }).join('');

  formEl.innerHTML =
    '<div class="card" style="padding:14px;margin-top:8px;border:1px solid rgba(34,211,238,.3)">' +
    '<div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:10px">' + (id ? 'Редактировать насос' : 'Новый насос') + '</div>' +
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">' +
    _dewFld('Название / №', 'text', 'dew-pf-name',  p ? p.name : '', 'НС-01') +
    _dewFld('Марка / модель', 'text', 'dew-pf-model', p ? p.model || '' : '', 'НЦС-100') +
    _dewFld('Производит. (м³/ч)', 'number', 'dew-pf-cap', p ? p.capacity || '' : '', '100') +
    '<div class="form-group"><label class="form-label">Зумпф</label><select id="dew-pf-sump" class="form-control">' + sumpOpts + '</select></div>' +
    '<div class="form-group"><label class="form-label">Статус</label><select id="dew-pf-status" class="form-control">' + statusOpts + '</select></div>' +
    '</div>' +
    '<div style="display:flex;gap:8px;margin-top:10px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-pf-save">Сохранить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-pf-cancel">Отмена</button>' +
    '</div></div>';

  document.getElementById('dew-pf-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-pf-save').onclick = function() {
    var name   = document.getElementById('dew-pf-name').value.trim();
    var sumpId = document.getElementById('dew-pf-sump').value;
    if (!name)   { Toast.show('Введите название насоса', 'warning'); return; }
    if (!sumpId) { Toast.show('Выберите зумпф', 'warning'); return; }
    var data = {
      name:     name,
      model:    document.getElementById('dew-pf-model').value.trim()  || '',
      capacity: parseFloat(document.getElementById('dew-pf-cap').value) || null,
      sumpId:   sumpId,
      status:   document.getElementById('dew-pf-status').value,
    };
    if (id) DewateringState.updatePump(id, data);
    else    DewateringState.addPump(data);
    formEl.innerHTML = '';
    _dewRenderPumpsList();
    Toast.show(id ? 'Насос обновлён' : 'Насос добавлен', 'success');
  };
}

function _dewDeletePump(id) {
  var p = DewateringState.pumpById(id);
  if (!p || !confirm('Удалить насос "' + p.name + '" и все его записи?')) return;
  DewateringState.deletePump(id);
  _dewRenderPumpsList();
  Toast.show('Насос удалён', 'info');
}

function _dewRenderDestList() {
  var el = document.getElementById('dew-dest-list');
  if (!el) return;
  if (!DewateringState.destinations.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:12px">Нет направлений</p>';
    return;
  }
  el.innerHTML = '<div style="display:flex;flex-direction:column;gap:5px">' +
    DewateringState.destinations.map(function(d) {
      var tp = DEW_DEST_TYPE[d.type] || {};
      return '<div style="display:flex;align-items:center;gap:8px;padding:6px 10px;background:var(--bg-3);border-radius:var(--r-sm);font-size:12px">' +
        '<span>' + (tp.icon || '•') + '</span>' +
        '<span style="flex:1;color:var(--txt-1)">' + escHTML(d.name) + '</span>' +
        '<span style="color:var(--txt-3);font-size:10px">' + (tp.label || '') + '</span>' +
        '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteDest(\'' + d.id + '\')">✕</button>' +
      '</div>';
    }).join('') +
  '</div>';
}

function _dewOpenDestForm() {
  var formEl = document.getElementById('dew-dest-form');
  if (!formEl) return;
  var typeOpts = Object.keys(DEW_DEST_TYPE).map(function(k) {
    return '<option value="' + k + '">' + DEW_DEST_TYPE[k].label + '</option>';
  }).join('');
  formEl.innerHTML =
    '<div class="card" style="padding:12px;margin-top:8px;border:1px solid var(--line)">' +
    '<div style="display:flex;gap:8px;align-items:flex-end;flex-wrap:wrap">' +
    _dewFld('Название', 'text', 'dew-df-name', '', 'Отстойник №2') +
    '<div class="form-group"><label class="form-label">Тип</label><select id="dew-df-type" class="form-control">' + typeOpts + '</select></div>' +
    '<div style="display:flex;gap:6px;padding-bottom:4px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000;white-space:nowrap" id="dew-df-save">Добавить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-df-cancel">✕</button>' +
    '</div></div></div>';

  document.getElementById('dew-df-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-df-save').onclick = function() {
    var name = document.getElementById('dew-df-name').value.trim();
    if (!name) { Toast.show('Введите название', 'warning'); return; }
    DewateringState.addDest({ name: name, type: document.getElementById('dew-df-type').value });
    formEl.innerHTML = '';
    _dewRenderDestList();
    Toast.show('Направление добавлено', 'success');
  };
}

function _dewDeleteDest(id) {
  DewateringState.deleteDest(id);
  _dewRenderDestList();
}

// ── Журнал работы ────────────────────────────────────────────

function _dewRenderJournal() {
  var el = document.getElementById('dew-panel-journal');
  if (!el) return;

  var today = new Date().toISOString().slice(0, 10);
  if (!_dewJournalFilter.month) _dewJournalFilter.month = today.slice(0, 7);

  var sumpOpts = '<option value="">Все зумпфы</option>' +
    DewateringState.sumps.map(function(s) {
      return '<option value="' + s.id + '"' + (_dewJournalFilter.sumpId === s.id ? ' selected' : '') + '>' + escHTML(s.name) + '</option>';
    }).join('');

  el.innerHTML =
    '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">' +
      '<select id="dew-jf-sump" class="form-control" style="width:160px;font-size:12px">' + sumpOpts + '</select>' +
      '<input type="month" id="dew-jf-month" class="form-control" value="' + _dewJournalFilter.month + '" style="width:145px;font-size:12px">' +
      '<button class="btn btn-sm" style="background:var(--gold);color:#000;font-size:11px" id="dew-btn-add-session">+ Записать смену</button>' +
      '<div style="margin-left:auto;font-size:11px;color:var(--txt-3)" id="dew-journal-summary"></div>' +
    '</div>' +
    '<div id="dew-session-form" style="margin-bottom:12px"></div>' +
    '<div id="dew-sessions-table"></div>';

  document.getElementById('dew-jf-sump').addEventListener('change', function() {
    _dewJournalFilter.sumpId = this.value;
    _dewRenderSessionsTable();
  });
  document.getElementById('dew-jf-month').addEventListener('change', function() {
    _dewJournalFilter.month = this.value;
    _dewRenderSessionsTable();
  });
  document.getElementById('dew-btn-add-session').addEventListener('click', function() {
    if (!DewateringState.pumps.length) { Toast.show('Сначала добавьте насосы на вкладке «Зумпфы»', 'warning'); return; }
    _dewOpenSessionForm(null);
  });

  _dewRenderSessionsTable();
}

function _dewRenderSessionsTable() {
  var el    = document.getElementById('dew-sessions-table');
  var sumEl = document.getElementById('dew-journal-summary');
  if (!el) return;

  var month  = _dewJournalFilter.month;
  var sumpId = _dewJournalFilter.sumpId;
  var from   = month + '-01';
  var to     = month + '-31';

  var sessions = DewateringState.sessions.filter(function(s) {
    if (s.date < from || s.date > to) return false;
    if (sumpId) {
      var pump = DewateringState.pumpById(s.pumpId);
      if (!pump || pump.sumpId !== sumpId) return false;
    }
    return true;
  });

  sessions.sort(function(a, b) {
    return b.date.localeCompare(a.date) || (b.shift || '').localeCompare(a.shift || '');
  });

  var totalVol = sessions.reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
  var totalHrs = sessions.reduce(function(a, s) { return a + (parseFloat(s.hoursWorked)  || 0); }, 0);

  if (sumEl) sumEl.innerHTML =
    'Итого: <b style="color:var(--txt-1)">' + totalVol.toFixed(0) + ' м³</b>' +
    ' · <b style="color:var(--txt-1)">' + totalHrs.toFixed(1) + ' ч</b>' +
    ' · ' + sessions.length + ' записей';

  if (!sessions.length) {
    el.innerHTML = '<div class="card" style="padding:24px;text-align:center;color:var(--txt-3);font-size:12px">' +
      (DewateringState.sessions.length ? 'Нет записей за выбранный период' : 'Журнал пуст — нажмите «Записать смену»') + '</div>';
    return;
  }

  el.innerHTML =
    '<div style="overflow-x:auto">' +
    '<table style="width:100%;border-collapse:collapse;font-size:12px;min-width:640px">' +
    '<thead><tr style="color:var(--txt-3);border-bottom:1px solid var(--line);font-size:10px;text-transform:uppercase;letter-spacing:.04em">' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Дата</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Смена</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Насос / Зумпф</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Часов</th>' +
      '<th style="padding:6px 8px;text-align:right;font-weight:500">Объём м³</th>' +
      '<th style="padding:6px 8px;text-align:left;font-weight:500">Направление</th>' +
      '<th style="padding:6px 8px;text-align:center;font-weight:500">Уровень до→после</th>' +
      '<th style="padding:6px 8px;font-weight:500"></th>' +
    '</tr></thead><tbody>' +
    sessions.map(function(s) {
      var pump  = DewateringState.pumpById(s.pumpId);
      var sump  = pump ? DewateringState.sumpById(pump.sumpId) : null;
      var dest  = DewateringState.destById(s.destinationId);
      var shLbl = s.shift === 'day' ? '☀ День' : s.shift === 'night' ? '☾ Ночь' : s.shift || '—';
      var lvl   = (s.levelBefore != null && s.levelBefore !== '')
        ? s.levelBefore + ' → ' + (s.levelAfter != null && s.levelAfter !== '' ? s.levelAfter : '?') + ' м'
        : '';
      return '<tr style="border-bottom:1px solid var(--line-2)">' +
        '<td style="padding:7px 8px;color:var(--txt-1)">' + s.date + '</td>' +
        '<td style="padding:7px 8px;color:var(--txt-2)">' + shLbl + '</td>' +
        '<td style="padding:7px 8px">' +
          '<div style="color:var(--txt-1)">' + (pump ? escHTML(pump.name) : '—') + '</div>' +
          (sump ? '<div style="color:var(--txt-3);font-size:10px">' + escHTML(sump.name) + (sump.horizon ? ' · гор. ' + sump.horizon + ' м' : '') + '</div>' : '') +
        '</td>' +
        '<td style="padding:7px 8px;text-align:right;color:var(--txt-2)">' + (parseFloat(s.hoursWorked) || 0).toFixed(1) + '</td>' +
        '<td style="padding:7px 8px;text-align:right;font-weight:600;color:var(--ok)">' + (parseFloat(s.volumePumped) || 0).toFixed(0) + '</td>' +
        '<td style="padding:7px 8px;color:var(--txt-2)">' + (dest ? escHTML(dest.name) : '—') + '</td>' +
        '<td style="padding:7px 8px;text-align:center;color:var(--txt-3);font-size:10px">' + lvl + '</td>' +
        '<td style="padding:7px 8px;text-align:right;white-space:nowrap">' +
          '<button class="btn btn-sm btn-outline" style="font-size:10px;padding:2px 6px;margin-right:3px" onclick="_dewOpenSessionForm(\'' + s.id + '\')">✎</button>' +
          '<button class="btn btn-sm" style="font-size:10px;padding:2px 6px;background:rgba(248,113,113,.1);color:var(--bad);border:1px solid rgba(248,113,113,.2)" onclick="_dewDeleteSession(\'' + s.id + '\')">✕</button>' +
        '</td>' +
      '</tr>';
    }).join('') +
    '</tbody>' +
    '<tfoot><tr style="background:var(--bg-3);border-top:1px solid var(--line)">' +
      '<td colspan="3" style="padding:7px 8px;font-size:11px;color:var(--txt-3);font-weight:600">ИТОГО</td>' +
      '<td style="padding:7px 8px;text-align:right;font-weight:700;color:var(--txt-1)">' + totalHrs.toFixed(1) + '</td>' +
      '<td style="padding:7px 8px;text-align:right;font-weight:700;color:var(--ok)">' + totalVol.toFixed(0) + '</td>' +
      '<td colspan="3"></td>' +
    '</tr></tfoot>' +
    '</table></div>';
}

function _dewOpenSessionForm(id) {
  var s = id ? DewateringState.sessions.find(function(x) { return x.id === id; }) : null;
  var formEl = document.getElementById('dew-session-form');
  if (!formEl) return;

  var today   = new Date().toISOString().slice(0, 10);
  var pumpOpts = DewateringState.pumps.map(function(p) {
    var sump = DewateringState.sumpById(p.sumpId);
    return '<option value="' + p.id + '"' + (s && s.pumpId === p.id ? ' selected' : '') + '>' +
      escHTML(p.name) + (sump ? ' — ' + escHTML(sump.name) : '') + '</option>';
  }).join('');
  var destOpts = '<option value="">— не указано —</option>' +
    DewateringState.destinations.map(function(d) {
      return '<option value="' + d.id + '"' + (s && s.destinationId === d.id ? ' selected' : '') + '>' + escHTML(d.name) + '</option>';
    }).join('');

  formEl.innerHTML =
    '<div class="card" style="padding:14px;border:1px solid var(--gold-2)">' +
    '<div style="font-size:12px;font-weight:600;color:var(--gold);margin-bottom:12px">' + (id ? 'Редактировать запись' : 'Новая запись смены') + '</div>' +
    '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(160px,1fr));gap:8px">' +
    _dewFld('Дата', 'date', 'dew-sf2-date', s ? s.date : today, '') +
    '<div class="form-group"><label class="form-label">Смена</label><select id="dew-sf2-shift" class="form-control">' +
      '<option value="day"'  + (!s || s.shift === 'day'   ? ' selected' : '') + '>☀ Дневная</option>' +
      '<option value="night"' + (s  && s.shift === 'night' ? ' selected' : '') + '>☾ Ночная</option>' +
    '</select></div>' +
    '<div class="form-group"><label class="form-label">Насос</label><select id="dew-sf2-pump" class="form-control">' + pumpOpts + '</select></div>' +
    _dewFld('Отработано (ч)', 'number', 'dew-sf2-hours', s ? s.hoursWorked : '12', '12') +
    _dewFld('Откачано (м³)', 'number', 'dew-sf2-vol', s ? s.volumePumped || '' : '', 'авто') +
    '<div class="form-group"><label class="form-label">Направление</label><select id="dew-sf2-dest" class="form-control">' + destOpts + '</select></div>' +
    _dewFld('Уровень до (м)', 'number', 'dew-sf2-lvlbefore', s ? s.levelBefore || '' : '', '') +
    _dewFld('Уровень после (м)', 'number', 'dew-sf2-lvlafter', s ? s.levelAfter || '' : '', '') +
    _dewFld('Примечание', 'text', 'dew-sf2-notes', s ? s.notes || '' : '', '') +
    '</div>' +
    '<p style="font-size:10px;color:var(--txt-3);margin:4px 0 10px">Если объём не введён — рассчитается автоматически: часы × производительность насоса</p>' +
    '<div style="display:flex;gap:8px">' +
    '<button class="btn btn-sm" style="background:var(--gold);color:#000" id="dew-sf2-save">Сохранить</button>' +
    '<button class="btn btn-sm btn-outline" id="dew-sf2-cancel">Отмена</button>' +
    '</div></div>';

  document.getElementById('dew-sf2-cancel').onclick = function() { formEl.innerHTML = ''; };
  document.getElementById('dew-sf2-save').onclick = function() {
    var pumpId = document.getElementById('dew-sf2-pump').value;
    var hours  = parseFloat(document.getElementById('dew-sf2-hours').value) || 0;
    var volRaw = document.getElementById('dew-sf2-vol').value.trim();
    var pump   = DewateringState.pumpById(pumpId);
    var vol    = volRaw ? parseFloat(volRaw) : (pump && pump.capacity ? hours * parseFloat(pump.capacity) : 0);
    if (!pumpId) { Toast.show('Выберите насос', 'warning'); return; }
    var date = document.getElementById('dew-sf2-date').value;
    if (!date)   { Toast.show('Укажите дату', 'warning'); return; }
    var data = {
      pumpId:        pumpId,
      sumpId:        pump ? pump.sumpId : '',
      date:          date,
      shift:         document.getElementById('dew-sf2-shift').value,
      hoursWorked:   hours,
      volumePumped:  Math.round(vol * 10) / 10,
      destinationId: document.getElementById('dew-sf2-dest').value || null,
      levelBefore:   document.getElementById('dew-sf2-lvlbefore').value.trim() || null,
      levelAfter:    document.getElementById('dew-sf2-lvlafter').value.trim()  || null,
      notes:         document.getElementById('dew-sf2-notes').value.trim()     || '',
    };
    if (id) DewateringState.updateSession(id, data);
    else    DewateringState.addSession(data);
    formEl.innerHTML = '';
    _dewRenderSessionsTable();
    Toast.show(id ? 'Запись обновлена' : 'Запись добавлена', 'success');
  };
}

function _dewDeleteSession(id) {
  if (!confirm('Удалить запись?')) return;
  DewateringState.deleteSession(id);
  _dewRenderSessionsTable();
}

// ── Аналитика ────────────────────────────────────────────────

function _dewRenderAnalytics() {
  var el = document.getElementById('dew-panel-analytics');
  if (!el) return;

  el.innerHTML =
    '<div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">' +
      '<div class="card" style="padding:14px"><div class="card-title">Тренд откачки (м³/сутки)</div><div id="dew-ch-trend"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Распределение по направлениям</div><div id="dew-ch-dest"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Наработка насосов</div><div id="dew-ch-pumps"></div></div>' +
      '<div class="card" style="padding:14px"><div class="card-title">Сравнение зумпфов (м³ по месяцам)</div><div id="dew-ch-sumps"></div></div>' +
    '</div>';

  _dewChartTrend();
  _dewChartDest();
  _dewChartPumps();
  _dewChartSumps();
}

function _dewChartTrend() {
  var el = document.getElementById('dew-ch-trend');
  if (!el) return;

  var days = [];
  for (var i = 29; i >= 0; i--) {
    var d = new Date(); d.setDate(d.getDate() - i);
    days.push(d.toISOString().slice(0, 10));
  }

  var data = days.map(function(day) {
    var vol = DewateringState.sessions
      .filter(function(s) { return s.date === day; })
      .reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
    return { day: day, vol: vol };
  });

  var maxV = Math.max.apply(null, data.map(function(d) { return d.vol; })) || 1;
  var W = 360, H = 120, PL = 38, PR = 8, PT = 8, PB = 22;
  var cW = W - PL - PR, cH = H - PT - PB;
  var n = data.length;
  var bW = Math.max(1, Math.floor(cW / n) - 1);

  var bars = data.map(function(d, i) {
    if (!d.vol) return '';
    var bH = Math.max(2, (d.vol / maxV) * cH);
    var x  = PL + i * (cW / n) + 1;
    var y  = PT + cH - bH;
    return '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + bW + '" height="' + bH.toFixed(1) + '"' +
      ' fill="' + (i === n - 1 ? 'var(--gold)' : 'var(--blue)') + '" opacity=".75" rx="1">' +
      '<title>' + d.day + ': ' + d.vol.toFixed(0) + ' м³</title></rect>';
  }).join('');

  var yLines = [0, maxV / 2, maxV].map(function(v) {
    var y = (PT + cH - (v / maxV) * cH).toFixed(1);
    return '<line x1="' + PL + '" y1="' + y + '" x2="' + (W - PR) + '" y2="' + y + '" stroke="rgba(255,255,255,.05)" stroke-width="1"/>' +
           '<text x="' + (PL - 3) + '" y="' + (parseFloat(y) + 3) + '" fill="var(--txt-3)" font-size="8" text-anchor="end">' + Math.round(v) + '</text>';
  }).join('');

  var xLbls = data.filter(function(_, i) { return i % 7 === 0 || i === n - 1; }).map(function(d) {
    var i = data.indexOf(d);
    var x = PL + i * (cW / n) + bW / 2;
    return '<text x="' + x.toFixed(1) + '" y="' + (H - 4) + '" fill="var(--txt-3)" font-size="7" text-anchor="middle">' + d.day.slice(5) + '</text>';
  }).join('');

  el.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;display:block">' + yLines + bars + xLbls + '</svg>';
  if (data.every(function(d) { return d.vol === 0; }))
    el.innerHTML += '<p style="color:var(--txt-3);font-size:11px;text-align:center;margin-top:4px">Нет данных за последние 30 дней</p>';
}

function _dewChartDest() {
  var el = document.getElementById('dew-ch-dest');
  if (!el) return;

  var byDest = {};
  DewateringState.sessions.forEach(function(s) {
    var key = s.destinationId || '__none__';
    byDest[key] = (byDest[key] || 0) + (parseFloat(s.volumePumped) || 0);
  });

  var total = Object.keys(byDest).reduce(function(a, k) { return a + byDest[k]; }, 0);
  if (!total) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет данных</p>';
    return;
  }

  var clrs = ['var(--gold)', 'var(--ok)', 'var(--warn)', 'var(--bad)', '#bc8cff', '#58a6ff'];
  var entries = Object.keys(byDest).map(function(k, i) {
    var dest = DewateringState.destById(k);
    return { name: dest ? dest.name : 'Не указано', vol: byDest[k], clr: clrs[i % clrs.length] };
  }).sort(function(a, b) { return b.vol - a.vol; });

  el.innerHTML = entries.map(function(e) {
    var pct = Math.round(e.vol / total * 100);
    return '<div style="margin-bottom:9px">' +
      '<div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:3px">' +
        '<span style="color:var(--txt-2)">' + escHTML(e.name) + '</span>' +
        '<span style="color:' + e.clr + ';font-weight:600">' + e.vol.toFixed(0) + ' м³ <span style="color:var(--txt-3);font-weight:400">(' + pct + '%)</span></span>' +
      '</div>' +
      '<div style="background:var(--bg-1);border-radius:3px;height:5px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + e.clr + ';border-radius:3px"></div>' +
      '</div>' +
    '</div>';
  }).join('') +
  '<div style="margin-top:8px;padding-top:8px;border-top:1px solid var(--line);font-size:11px;color:var(--txt-3)">' +
    'Всего: <b style="color:var(--txt-1)">' + total.toFixed(0) + ' м³</b></div>';
}

function _dewChartPumps() {
  var el = document.getElementById('dew-ch-pumps');
  if (!el) return;
  if (!DewateringState.pumps.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет насосов</p>';
    return;
  }

  var pumps = DewateringState.pumps.slice().sort(function(a, b) {
    return DewateringState.totalHours(b.id) - DewateringState.totalHours(a.id);
  });
  var maxH = DewateringState.totalHours(pumps[0].id) || 1;

  el.innerHTML = pumps.map(function(p) {
    var hrs = DewateringState.totalHours(p.id);
    var vol = DewateringState.totalVol(p.id);
    var pct = Math.round(hrs / maxH * 100);
    var st  = DEW_PUMP_STATUS[p.status] || DEW_PUMP_STATUS.off;
    var clr = p.status === 'working' ? 'var(--ok)' : p.status === 'standby' ? 'var(--blue)' : p.status === 'repair' ? 'var(--warn)' : 'var(--txt-3)';
    return '<div style="margin-bottom:10px">' +
      '<div style="display:flex;justify-content:space-between;align-items:center;font-size:11px;margin-bottom:3px">' +
        '<div style="display:flex;align-items:center;gap:6px">' +
          '<span style="color:var(--txt-1)">' + escHTML(p.name) + '</span>' +
          '<span class="anl-pill anl-pill-' + st.cls + '" style="font-size:9px">' + st.label + '</span>' +
        '</div>' +
        '<span style="color:var(--txt-2)">' + hrs.toFixed(1) + ' ч · ' + vol.toFixed(0) + ' м³</span>' +
      '</div>' +
      '<div style="background:var(--bg-1);border-radius:3px;height:6px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + clr + ';border-radius:3px"></div>' +
      '</div>' +
    '</div>';
  }).join('');
}

function _dewChartSumps() {
  var el = document.getElementById('dew-ch-sumps');
  if (!el) return;
  if (!DewateringState.sumps.length) {
    el.innerHTML = '<p style="color:var(--txt-3);font-size:11px;text-align:center;padding:20px">Нет зумпфов</p>';
    return;
  }

  var now = new Date();
  var months = [];
  var ruMonths = ['янв','фев','мар','апр','май','июн','июл','авг','сен','окт','ноя','дек'];
  for (var i = 2; i >= 0; i--) {
    var d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    months.push({ key: d.toISOString().slice(0, 7), label: ruMonths[d.getMonth()] });
  }

  var clrs = ['var(--gold)', 'var(--ok)', 'var(--warn)', 'var(--bad)', '#bc8cff'];
  var rows = DewateringState.sumps.map(function(sump, si) {
    var pumps  = DewateringState.pumpsOfSump(sump.id);
    var pumpIds = pumps.map(function(p) { return p.id; });
    var vols = months.map(function(m) {
      return DewateringState.sessions.filter(function(s) {
        return s.date.slice(0, 7) === m.key && pumpIds.indexOf(s.pumpId) >= 0;
      }).reduce(function(a, s) { return a + (parseFloat(s.volumePumped) || 0); }, 0);
    });
    return { sump: sump, vols: vols, clr: clrs[si % clrs.length] };
  });

  var maxV = 0;
  rows.forEach(function(r) { r.vols.forEach(function(v) { if (v > maxV) maxV = v; }); });
  maxV = maxV || 1;

  el.innerHTML = rows.map(function(r) {
    return '<div style="margin-bottom:14px">' +
      '<div style="font-size:11px;color:var(--txt-1);font-weight:600;margin-bottom:6px">' +
        escHTML(r.sump.name) +
        (r.sump.horizon ? ' <span style="color:var(--txt-3);font-weight:400;font-size:10px">гор. ' + r.sump.horizon + ' м</span>' : '') +
      '</div>' +
      '<div style="display:flex;gap:6px;align-items:flex-end;height:48px">' +
        r.vols.map(function(v, i) {
          var h = v > 0 ? Math.max(4, Math.round(v / maxV * 42)) : 0;
          return '<div style="display:flex;flex-direction:column;align-items:center;gap:2px;flex:1">' +
            '<div style="font-size:9px;color:var(--txt-3)">' + (v > 0 ? v.toFixed(0) : '') + '</div>' +
            '<div style="width:100%;background:' + r.clr + ';height:' + h + 'px;border-radius:2px 2px 0 0;opacity:.8"></div>' +
            '<div style="font-size:9px;color:var(--txt-3)">' + months[i].label + '</div>' +
          '</div>';
        }).join('') +
      '</div>' +
    '</div>';
  }).join('');
}

// ── Helpers ──────────────────────────────────────────────────

function _dewFld(label, type, id, value, placeholder) {
  return '<div class="form-group">' +
    '<label class="form-label">' + escHTML(label) + '</label>' +
    '<input type="' + type + '" id="' + id + '" class="form-control"' +
    ' value="' + escAttr(String(value != null ? value : '')) + '"' +
    (placeholder ? ' placeholder="' + escAttr(placeholder) + '"' : '') + '>' +
    '</div>';
}
